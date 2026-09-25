import { useState } from 'react'

export function inviteLink(endpoint: string, token: string, appBase = import.meta.env.BASE_URL || '/') {
  const origin = typeof location === 'undefined' ? '' : location.origin
  return `${origin}${appBase}join.html#e=${encodeURIComponent(endpoint)}&t=${token}`
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

export function inviteMailto(email: string, name: string, link: string, from: string) {
  const body = [
    `Hi ${firstName(name)},`,
    '',
    "Here's your link to SPARC'd. It opens once and expires in 7 days.",
    '',
    link,
    '',
    from,
  ].join('\n')
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Your SPARC'd link")}&body=${encodeURIComponent(body)}`
}

/** Shown after adding a person and after resetting one. */
export function InviteLink({ name, email, link, from }: { name: string; email: string; link: string; from: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-3 border border-rule bg-paperHover p-3">
      <p className="m-0 text-sm text-ink">Send {firstName(name)} this link. It works once and expires in 7 days.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          readOnly
          aria-label="Link to send"
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-10 min-w-0 flex-1 border border-rule bg-paper px-2 font-mono text-xs text-ink"
        />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(link)
            setCopied(true)
          }}
          className="border border-rule px-3 py-2 text-sm text-ink hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <a
        href={inviteMailto(email, name, link, from)}
        className="mt-2 inline-block text-sm text-ink underline underline-offset-4"
      >
        Email it instead
      </a>
    </div>
  )
}
