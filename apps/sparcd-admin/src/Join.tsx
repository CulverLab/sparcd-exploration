import { useEffect, useState } from 'react'
import { saveSharedConnection } from '@sparcd/auth-ui'
import { detectBackendDefaults } from '@sparcd/s3-safe'
import { ApiError, join, type JoinResult } from './api'

const USED = 'This link has already been used or has expired. Ask your administrator for a new one.'
const BROKEN = 'This link is missing something. Ask your administrator for a new one.'

export type JoinState =
  | { step: 'working' }
  | { step: 'welcome'; name: string }
  | { step: 'problem'; message: string }

/** The fragment keeps the token out of every request log along the way. */
export function readInvite(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const endpoint = params.get('e') ?? ''
  const token = params.get('t') ?? ''
  return endpoint && token ? { endpoint, token } : null
}

export function connectionFor(result: JoinResult) {
  const defaults = detectBackendDefaults(result.endpoint)
  return {
    endpoint: result.endpoint,
    region: defaults.region,
    accessKey: result.accessKey,
    secretKey: result.secretKey,
    forcePathStyle: defaults.forcePathStyle,
    secure: defaults.secure,
  }
}

const tools = [
  { name: 'Uploader', href: '../uploader/' },
  { name: 'Tagger', href: '../tagger/' },
  { name: 'Explorer', href: '../explorer/' },
]

export function Join({ doJoin = join }: { doJoin?: typeof join } = {}) {
  const [state, setState] = useState<JoinState>({ step: 'working' })

  useEffect(() => {
    const invite = readInvite(location.hash)
    if (!invite) {
      setState({ step: 'problem', message: BROKEN })
      return
    }
    void (async () => {
      try {
        const result = await doJoin(invite.endpoint, invite.token)
        saveSharedConnection(connectionFor(result), true)
        history.replaceState(null, '', location.pathname + location.search)
        setState({ step: 'welcome', name: result.name })
      } catch (cause) {
        const used = cause instanceof ApiError && cause.status === 404
        setState({ step: 'problem', message: used ? USED : 'That link could not be opened. Ask your administrator for a new one.' })
      }
    })()
  }, [])

  return (
    <main className="grid min-h-[100svh] place-items-center bg-paper p-6">
      <div className="w-full max-w-md border border-rule bg-panel p-8">
        <p className="m-0 font-display text-xl font-semibold text-ink">SPARC'd</p>
        {state.step === 'working' && <p className="mt-4 text-sm text-inkSoft" role="status">Setting you up…</p>}
        {state.step === 'problem' && <p className="mt-4 text-sm text-warn" role="alert">{state.message}</p>}
        {state.step === 'welcome' && (
          <>
            <h1 className="mb-1 mt-4 text-lg font-semibold text-ink">Welcome, {state.name}. You're all set.</h1>
            <p className="mt-1 text-sm text-inkSoft">Open any of these to get going.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {tools.map((tool) => (
                <a
                  key={tool.name}
                  href={tool.href}
                  className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {tool.name}
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
