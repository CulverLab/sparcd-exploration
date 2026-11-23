import { useState } from 'react'
import type { AccessApi, Invite, Person } from './api'
import { AccessCells, AccessHeadings, type AccessRow } from './AccessChoices'
import { InviteLink, inviteLink } from './InviteLink'

export function AddPerson({ api, endpoint, collections, from, onAdded, onClose }: {
  api: AccessApi
  endpoint: string
  collections: { bucket: string; name: string }[]
  from: string
  onAdded: () => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  // By bucket. A collection with nothing ticked is one they are not added to.
  const [grants, setGrants] = useState<Record<string, AccessRow>>({})
  const [added, setAdded] = useState<{ person: Person; invite: Invite } | null>(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setProblem('')
    try {
      setAdded(await api.addPerson({
        name: name.trim(),
        email: email.trim(),
        memberships: collections
          .filter((entry) => grants[entry.bucket]?.access.length)
          .map((entry) => ({ bucket: entry.bucket, ...grants[entry.bucket] })),
      }))
      onAdded()
    } catch (cause) {
      setProblem((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const again = () => {
    setAdded(null)
    setName('')
    setEmail('')
    setGrants({})
  }

  const inputClass = 'min-h-10 w-full border border-rule bg-paper px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

  return (
    <section className="mt-4 border border-rule bg-panel" aria-labelledby="add-person-heading">
      <h2 id="add-person-heading" className="m-0 border-b border-rule px-4 py-3 text-base font-semibold text-ink">Add a person</h2>
      <div className="p-4">
        {added ? (
          <>
            <InviteLink name={added.person.name} email={added.person.email} link={inviteLink(endpoint, added.invite.token)} from={from} />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onClose} className="border border-ink bg-ink px-3 py-2 text-sm font-semibold text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Done</button>
              <button type="button" onClick={again} className="border border-rule px-3 py-2 text-sm text-ink hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Add another person</button>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium text-ink">
                Name
                <input aria-label="Name" className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm font-medium text-ink">
                Email
                <input aria-label="Email" type="email" className={inputClass} value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
            </div>
            {collections.length > 0 && (
              <>
                <p className="mb-0 mt-3 text-sm font-medium text-ink">Collections <span className="font-normal text-inkSoft">(optional)</span></p>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <AccessHeadings first="Collection" />
                    </thead>
                    <tbody>
                      {collections.map((entry) => (
                        <tr key={entry.bucket} className="border-t border-ruleSoft">
                          <td className="py-2 pr-3 text-ink">{entry.name}</td>
                          <AccessCells
                            label={entry.name}
                            row={grants[entry.bucket] ?? { access: [], exactLocations: false }}
                            onChange={(next) => setGrants({ ...grants, [entry.bucket]: next })}
                          />
                          <td className="py-2" />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {problem && <p role="alert" className="mt-3 text-sm text-warn">{problem}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !name.trim() || !email.trim()}
                onClick={() => void submit()}
                className="border border-ink bg-ink px-3 py-2 text-sm font-semibold text-paper disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Add person
              </button>
              <button type="button" onClick={onClose} className="border border-rule px-3 py-2 text-sm text-inkSoft hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Cancel</button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
