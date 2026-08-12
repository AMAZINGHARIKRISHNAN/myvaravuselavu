import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isStaleChunkError, reloadedRecently, clearReloadFlag } from './lazyWithRetry'

describe('telling a stale build apart from a real crash', () => {
  it('recognises how each browser reports a chunk that no longer exists', () => {
    const wordings = [
      new Error('Failed to fetch dynamically imported module: /assets/Charts-DUwcLzUo.js'),
      new Error('Importing a module script failed.'), // Safari
      new Error('Loading chunk 42 failed.'), // older webpack-style
      new Error('error loading dynamically imported module'), // Firefox
    ]
    for (const error of wordings) expect(isStaleChunkError(error)).toBe(true)
  })

  it('leaves genuine errors alone, so they still surface', () => {
    expect(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(
      false
    )
    expect(isStaleChunkError(new Error('Missing or insufficient permissions'))).toBe(false)
    expect(isStaleChunkError(undefined)).toBe(false)
    expect(isStaleChunkError({})).toBe(false)
  })
})

// The reload guard. A boolean flag was cleared by main.jsx's `load` listener —
// which fires on the reload the guard itself caused — so a chunk that really
// was missing reloaded the page in a loop. A timestamp cannot be cleared by
// the thing it is guarding against.
describe('the one-reload guard', () => {
  // Node test env has no sessionStorage — same fake shape the browser gives us.
  let store
  beforeEach(() => {
    store = new Map()
    globalThis.sessionStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    }
  })
  afterEach(() => {
    delete globalThis.sessionStorage
  })

  it('allows the first reload after a stale chunk', () => {
    expect(reloadedRecently()).toBe(false)
  })

  it('blocks a second reload straight after the first — no loop', () => {
    store.set('vs_chunk_reloaded_at', String(Date.now()))
    expect(reloadedRecently()).toBe(true)
  })

  it('reopens once the window has passed, so a later deploy still reloads', () => {
    store.set('vs_chunk_reloaded_at', String(Date.now() - 60_000))
    expect(reloadedRecently()).toBe(false)
  })

  it('a successful chunk load clears it immediately', () => {
    store.set('vs_chunk_reloaded_at', String(Date.now()))
    clearReloadFlag()
    expect(reloadedRecently()).toBe(false)
  })

  it('ignores junk in storage rather than wedging', () => {
    store.set('vs_chunk_reloaded_at', 'not-a-number')
    expect(reloadedRecently()).toBe(false)
  })

  it('survives a clock that jumped backwards', () => {
    store.set('vs_chunk_reloaded_at', String(Date.now() + 5 * 60_000))
    expect(reloadedRecently()).toBe(false)
  })

  it('fails closed when storage throws, rather than reloading blind', () => {
    globalThis.sessionStorage = {
      getItem: () => {
        throw new Error('private mode')
      },
      setItem: () => {},
      removeItem: () => {},
    }
    expect(reloadedRecently()).toBe(true)
  })
})
