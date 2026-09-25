// Shared jsdom helpers for the component tests.
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export function render(element: ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(element))
  return {
    host,
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  }
}

export const settle = () => act(async () => {})

export function button(host: HTMLElement, text: string) {
  const all = Array.from(host.querySelectorAll('button'))
  const found = all.find((candidate) => candidate.textContent?.trim() === text)
  if (!found) throw Error(`no button “${text}” — found: ${all.map((one) => one.textContent?.trim()).join(' | ')}`)
  return found
}

export const hasButton = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll('button')).some((candidate) => candidate.textContent?.trim() === text)

export const rowButtons = (host: HTMLElement) => Array.from(host.querySelectorAll('li button'))

export const field = (host: HTMLElement, label: string) =>
  host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement

export const click = (element: Element) => act(async () => { (element as HTMLElement).click() })

export function type(input: HTMLInputElement, value: string) {
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
