import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — plain JavaScript, shared with the proxy's own harness.
import { startStack } from './stack.mjs'

const STATE = fileURLToPath(new URL('./.state.json', import.meta.url))
const SHOTS = fileURLToPath(new URL('./shots', import.meta.url))

export default async function globalSetup() {
  // The scenarios hand each other people and connections through this file, so
  // a rerun must not inherit the last one's.
  await rm(STATE, { force: true })
  await rm(SHOTS, { recursive: true, force: true })
  const stack = await startStack()
  return () => stack.stop()
}
