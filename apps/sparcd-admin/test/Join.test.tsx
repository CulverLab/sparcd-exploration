// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Join, connectionFor, readInvite } from '../src/Join'
import { ApiError } from '../src/api'
import { render, settle } from './dom'

const result = { endpoint: 'https://storage.test', accessKey: 'SPK1', secretKey: 'super-secret', name: 'Ana Morales' }

const openLink = (hash: string) => { location.hash = hash }

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  location.hash = ''
})
afterEach(() => { document.body.innerHTML = '' })

describe('reading the link', () => {
  it('takes the endpoint and token out of the fragment', () => {
    expect(readInvite('#e=storage.test&t=abc')).toEqual({ endpoint: 'storage.test', token: 'abc' })
    expect(readInvite(`#e=${encodeURIComponent('https://storage.test:9000')}&t=abc`)?.endpoint).toBe('https://storage.test:9000')
    expect(readInvite('#t=abc')).toBeNull()
    expect(readInvite('')).toBeNull()
  })

  it('fills in what the connection needs from the endpoint', () => {
    const connection = connectionFor(result)
    expect(connection.accessKey).toBe('SPK1')
    expect(connection.region).toBeTruthy()
  })
})

describe('joining', () => {
  it('welcomes the person, saves the connection and clears the link', async () => {
    openLink('#e=storage.test&t=one-time')
    let seen: [string, string] | null = null
    const view = render(<Join doJoin={async (endpoint, token) => { seen = [endpoint, token]; return result }} />)
    await settle()

    expect(seen).toEqual(['storage.test', 'one-time'])
    expect(view.host.textContent).toContain("Welcome, Ana Morales. You're all set.")
    expect(location.hash).toBe('')
    expect(sessionStorage.getItem('sparcd-connection-tab')).toContain('SPK1')
    expect(localStorage.getItem('sparcd-connection')).toContain('SPK1')
  })

  it('never puts the secret on the page', async () => {
    openLink('#e=storage.test&t=one-time')
    const view = render(<Join doJoin={async () => result} />)
    await settle()
    expect(view.host.textContent).not.toContain('super-secret')
    expect(view.host.innerHTML).not.toContain('super-secret')
  })

  it('offers the three tools by their ordinary links', async () => {
    openLink('#e=storage.test&t=one-time')
    const view = render(<Join doJoin={async () => result} />)
    await settle()
    expect(Array.from(view.host.querySelectorAll('a')).map((one) => one.getAttribute('href'))).toEqual([
      '../uploader/', '../tagger/', '../explorer/',
    ])
  })

  it('says plainly when the link was already used', async () => {
    openLink('#e=storage.test&t=spent')
    const view = render(<Join doJoin={async () => { throw new ApiError(404, 'not_found', 'gone') }} />)
    await settle()
    expect(view.host.textContent).toContain('This link has already been used or has expired. Ask your administrator for a new one.')
    expect(sessionStorage.getItem('sparcd-connection-tab')).toBeNull()
  })

  it('says plainly when the link is missing its parts', async () => {
    openLink('#nothing=here')
    const view = render(<Join doJoin={async () => result} />)
    await settle()
    expect(view.host.textContent).toContain('Ask your administrator for a new one.')
  })
})
