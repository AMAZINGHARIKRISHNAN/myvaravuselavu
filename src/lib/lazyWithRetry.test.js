import { describe, it, expect } from 'vitest'
import { isStaleChunkError } from './lazyWithRetry'

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
