// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Chrome, type AdminSection } from '../src/Chrome'
import { render } from './dom'

const sections: AdminSection[] = ['species', 'locations', 'collections', 'people', 'activity', 'settings']

const chrome = () => render(
  <Chrome
    identity="admin"
    theme="light"
    sections={sections}
    section="collections"
    onSectionChange={() => {}}
    onToggleTheme={() => {}}
    onDisconnect={() => {}}
  >
    <p>body</p>
  </Chrome>,
)

afterEach(() => { document.body.innerHTML = '' })

describe('the compact section nav', () => {
  it('lays the six sections out in three columns instead of one unshrinkable row', () => {
    const { host } = chrome()
    const nav = host.querySelectorAll('nav[aria-label="Sections"]')[0]
    expect(nav.className).toContain('grid-cols-3')
    const buttons = Array.from(nav.querySelectorAll('button'))
    expect(buttons).toHaveLength(6)
    expect(buttons.some((one) => one.className.includes('flex-1'))).toBe(false)
  })

  it('marks the section you are on', () => {
    const { host } = chrome()
    const nav = host.querySelectorAll('nav[aria-label="Sections"]')[0]
    const current = Array.from(nav.querySelectorAll('button[aria-current="page"]'))
    expect(current.map((one) => one.textContent?.trim())).toEqual(['Collections'])
  })
})
