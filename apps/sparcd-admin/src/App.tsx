import { useEffect, useRef, useState } from 'react'
import { RegistryEditor } from './RegistryEditor'
import { CollectionEditor } from './CollectionEditor'
import { Chrome, type AdminSection } from './Chrome'
import {
  clearSharedConnection,
  Connection,
  loadPersistedConnection,
  loadSessionConnection,
  saveSharedConnection,
  subscribeSharedConnection,
  loadSharedTheme,
  saveSharedTheme,
  type Theme,
} from '@sparcd/auth-ui'
import type { S3Config } from '@sparcd/types'
import { SafeS3Client } from '@sparcd/s3-safe'
import { loadAdminData, probeWriteAccess, type AdminData } from './load'
import { createApi, identify, type AccessApi, type Person, type WhoAmI } from './api'
import { PeopleScreen } from './PeopleScreen'
import { ActivityScreen } from './ActivityScreen'
import { CollectionMembers } from './CollectionMembers'

const IDENTITY_KEY = 'sparcd-admin-identity'

export type MakeClient = (config: S3Config, readAllowlist: string[], writeAllowlist: string[]) => SafeS3Client
export type MakeApi = (config: S3Config) => AccessApi

type Scope = 'species' | 'locations' | 'collections' | 'all'

export function App({
  makeClient = (config, read, write) => new SafeS3Client(config, read, write),
  makeApi = (config) => createApi(config),
}: { makeClient?: MakeClient; makeApi?: MakeApi } = {}) {
  const [config, setConfig] = useState<S3Config | null>(null)
  const [data, setData] = useState<AdminData | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [identity, setIdentity] = useState('')
  const [theme, setTheme] = useState<Theme>(() => loadSharedTheme() ?? 'light')
  const [section, setSection] = useState<AdminSection>('species')
  const [me, setMe] = useState<WhoAmI | null>(null)
  const [api, setApi] = useState<AccessApi | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const configRef = useRef<S3Config | null>(null)
  const started = useRef(false)
  // Every load carries a number. A login or reload that finishes after a newer
  // one started is dropped rather than installing its client over the top.
  const runId = useRef(0)

  useEffect(() => {
    configRef.current = config
  }, [config])

  const load = (target: S3Config) => loadAdminData((read, write) => makeClient(target, read, write))

  const authorize = async (nextConfig: S3Config, remember = true) => {
    const run = ++runId.current
    setConnecting(true)
    setError('')
    try {
      const loaded = await load(nextConfig)
      const service = makeApi(nextConfig)
      const whoami = await identify(service)
      const who = sessionStorage.getItem(IDENTITY_KEY) || whoami?.name || ''
      await probeWriteAccess(loaded.client, loaded.species.bucket, who.trim() || 'unnamed administrator')
      if (run !== runId.current) return
      saveSharedConnection(nextConfig, remember)
      setIdentity(who)
      setMe(whoami)
      setApi(whoami?.admin ? service : null)
      setPeople(whoami?.admin ? await service.listPeople().catch(() => []) : [])
      setData(loaded)
      setConfig(nextConfig)
      setNotice('')
    } catch (cause) {
      if (run !== runId.current) return
      setConfig(null)
      setData(null)
      setError((cause as Error).message)
    } finally {
      if (run === runId.current) setConnecting(false)
    }
  }

  // Reloading reads the lists again and nothing else: the session stays put and
  // a failure leaves whatever is on screen alone rather than dropping drafts.
  // Only the part that was just saved is taken from the result, so an untouched
  // editor never has its draft pulled out from under it.
  const refresh = async (scope: Scope = 'all') => {
    const current = configRef.current
    if (!current) return
    const run = ++runId.current
    try {
      const loaded = await load(current)
      if (run !== runId.current) return
      setData((previous) => (!previous || scope === 'all' ? loaded : {
        client: loaded.client,
        species: scope === 'species' ? loaded.species : previous.species,
        locations: scope === 'locations' ? loaded.locations : previous.locations,
        collections: scope === 'collections' ? loaded.collections : previous.collections,
      }))
      setNotice('')
    } catch (cause) {
      if (run !== runId.current) return
      setNotice(`The lists could not be reloaded. ${(cause as Error).message}`)
    }
  }

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    if (!started.current) {
      started.current = true
      const sessionConfig = loadSessionConnection()
      if (sessionConfig) void authorize(sessionConfig)
    }
    return subscribeSharedConnection(
      (sharedConfig) => {
        if (sharedConfig) void authorize(sharedConfig)
        else {
          setConfig(null)
          setData(null)
        }
      },
      () => configRef.current,
    )
  }, [])

  if (config && me && !me.admin) {
    return (
      <div className="grid min-h-[100svh] place-items-center bg-paper p-6">
        <div className="w-full max-w-md border border-rule bg-panel p-8">
          <h1 className="m-0 text-lg font-semibold text-ink">This login can't manage SPARC'd.</h1>
          <p className="mt-2 text-sm text-inkSoft">Ask an administrator for access.</p>
          <button
            type="button"
            onClick={() => {
              runId.current += 1
              clearSharedConnection()
              setConfig(null)
              setData(null)
              setMe(null)
            }}
            className="mt-4 border border-ink bg-ink px-3 py-2 text-sm font-semibold text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Logout
          </button>
        </div>
      </div>
    )
  }

  if (!config || !data) {
    return (
      <>
        <Connection
          toolName="Admin"
          defaultRemember
          initialConfig={loadPersistedConnection() ?? undefined}
          onConnect={(nextConfig, remember) => void authorize(nextConfig, remember)}
        />
        {connecting && <p role="status">Opening the configuration workspace…</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </>
    )
  }

  const setName = (value: string) => {
    setIdentity(value)
    sessionStorage.setItem(IDENTITY_KEY, value)
  }
  const actor = identity.trim() || config.accessKey

  const toggleTheme = () => {
    const nextTheme: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    saveSharedTheme(nextTheme)
  }


  const named = data.collections.map((entry) => ({ bucket: entry.bucket, name: entry.name ?? entry.bucket }))
  const sections: AdminSection[] = api
    ? ['species', 'locations', 'collections', 'people', 'activity', 'settings']
    : ['species', 'locations', 'collections', 'settings']

  return (
    <Chrome
      identity={actor}
      theme={theme}
      sections={sections}
      section={sections.includes(section) ? section : 'species'}
      onSectionChange={setSection}
      onToggleTheme={toggleTheme}
      onDisconnect={() => {
        runId.current += 1
        clearSharedConnection()
        setConfig(null)
        setData(null)
        setMe(null)
      }}
    >
      <div className="max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {notice && <p role="alert" className="mb-4 border border-warn px-3 py-2 text-sm text-warn">{notice}</p>}
        <div className={section === 'species' ? '' : 'hidden'}>
          <RegistryEditor title="Species" registry={data.species} client={data.client} actor={actor} reload={() => void refresh('species')} />
        </div>
        <div className={section === 'locations' ? '' : 'hidden'}>
          <RegistryEditor title="Locations" registry={data.locations} client={data.client} actor={actor} reload={() => void refresh('locations')} />
        </div>
        <div className={section === 'collections' ? '' : 'hidden'}>
          <CollectionEditor
            collections={data.collections}
            client={data.client}
            actor={actor}
            speciesRegistry={data.species.value}
            locationsRegistry={data.locations.value}
            reload={() => void refresh('collections')}
            membersFor={api ? (record) => <CollectionMembers api={api} bucket={record.bucket} people={people} /> : undefined}
          />
        </div>
        {api && section === 'people' && (
          <PeopleScreen api={api} endpoint={config.endpoint} collections={named} from={actor} />
        )}
        {api && section === 'activity' && (
          <ActivityScreen api={api} collections={named} people={people} />
        )}
        {section === 'settings' && <section className="max-w-2xl border border-rule bg-panel p-4" aria-labelledby="settings-heading">
          <h1 id="settings-heading" className="m-0 text-lg font-semibold text-ink">Settings</h1>
          <p className="mb-3 mt-1 text-sm text-inkSoft">Your name is recorded next to every change you make.</p>
          <label className="block max-w-md text-sm font-medium text-ink">
            Your name
            <input
              className="mt-1 block w-full border border-rule bg-paper px-3 py-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              value={identity}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {!identity.trim() && <p role="alert" className="mb-0 mt-2 text-sm text-inkSoft">Without a name, changes are recorded under the login ID {config.accessKey}.</p>}
        </section>}
      </div>
    </Chrome>
  )
}
