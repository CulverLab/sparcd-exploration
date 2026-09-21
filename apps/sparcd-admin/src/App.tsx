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

const IDENTITY_KEY = 'sparcd-admin-identity'

export type MakeClient = (config: S3Config, readAllowlist: string[], writeAllowlist: string[]) => SafeS3Client

export function App({ makeClient = (config, read, write) => new SafeS3Client(config, read, write) }: { makeClient?: MakeClient } = {}) {
  const [config, setConfig] = useState<S3Config | null>(null)
  const [data, setData] = useState<AdminData | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [identity, setIdentity] = useState('')
  const [theme, setTheme] = useState<Theme>(() => loadSharedTheme() ?? 'light')
  const [section, setSection] = useState<AdminSection>('species')
  const configRef = useRef<S3Config | null>(null)
  const started = useRef(false)

  useEffect(() => {
    configRef.current = config
  }, [config])

  const load = (target: S3Config) => loadAdminData((read, write) => makeClient(target, read, write))

  const authorize = async (nextConfig: S3Config, remember = true) => {
    setConnecting(true)
    setError('')
    try {
      const loaded = await load(nextConfig)
      const who = sessionStorage.getItem(IDENTITY_KEY) ?? ''
      await probeWriteAccess(loaded.client, loaded.species.bucket, who.trim() || 'unnamed administrator')
      saveSharedConnection(nextConfig, remember)
      setIdentity(who)
      setData(loaded)
      setConfig(nextConfig)
      setNotice('')
    } catch (cause) {
      setConfig(null)
      setData(null)
      setError((cause as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  // Reloading reads the lists again and nothing else: the session stays put and
  // a failure leaves whatever is on screen alone rather than dropping drafts.
  const refresh = async () => {
    const current = configRef.current
    if (!current) return
    try {
      setData(await load(current))
      setNotice('')
    } catch (cause) {
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

  const reload = () => void refresh()

  return (
    <Chrome
      identity={actor}
      theme={theme}
      section={section}
      onSectionChange={setSection}
      onToggleTheme={toggleTheme}
      onDisconnect={() => {
        clearSharedConnection()
        setConfig(null)
        setData(null)
      }}
    >
      <div className="max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {notice && <p role="alert" className="mb-4 border border-warn px-3 py-2 text-sm text-warn">{notice}</p>}
        <div className={section === 'species' ? '' : 'hidden'}>
          <RegistryEditor title="Species" registry={data.species} client={data.client} actor={actor} reload={reload} />
        </div>
        <div className={section === 'locations' ? '' : 'hidden'}>
          <RegistryEditor title="Locations" registry={data.locations} client={data.client} actor={actor} reload={reload} />
        </div>
        <div className={section === 'collections' ? '' : 'hidden'}>
          <CollectionEditor collections={data.collections} client={data.client} actor={actor} speciesRegistry={data.species.value} locationsRegistry={data.locations.value} reload={reload} />
        </div>
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
