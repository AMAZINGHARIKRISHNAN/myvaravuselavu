import { describe, it, expect, beforeEach } from 'vitest'
import { recordAmount, topAmounts } from './quickAmounts'

// Node test env has no localStorage — back it with an in-memory map.
let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
})

const KEY = 'vs_amount_freq'
const saved = () => JSON.parse(store.get(KEY) || '{}')

describe('recordAmount', () => {
  it('counts repeated amounts', () => {
    recordAmount(500)
    recordAmount(500)
    recordAmount(1200)
    expect(saved()).toEqual({ 500: 2, 1200: 1 })
  })

  it('rounds to whole units', () => {
    recordAmount(499.6)
    expect(saved()).toEqual({ 500: 1 })
  })

  it('ignores zero, negative, and non-numeric amounts', () => {
    recordAmount(0)
    recordAmount(-300)
    recordAmount('abc')
    recordAmount(null)
    expect(saved()).toEqual({})
  })

  it('caps the map at 50 amounts, keeping the most frequent', () => {
    // 60 distinct amounts, each logged once…
    for (let i = 1; i <= 60; i++) recordAmount(i * 10)
    // …then one favourite logged many times.
    for (let i = 0; i < 5; i++) recordAmount(999)
    const entries = saved()
    expect(Object.keys(entries).length).toBeLessThanOrEqual(50)
    expect(entries[999]).toBe(5)
  })

  it('survives corrupt stored JSON', () => {
    store.set(KEY, '{not json')
    recordAmount(700)
    expect(saved()).toEqual({ 700: 1 })
  })
})

describe('topAmounts', () => {
  it('returns defaults when nothing is learned', () => {
    expect(topAmounts()).toEqual([500, 1000, 3000])
  })

  it('requires an amount to be entered twice before suggesting it', () => {
    recordAmount(750)
    expect(topAmounts()).toEqual([500, 1000, 3000])
    recordAmount(750)
    expect(topAmounts()).toEqual([750, 500, 1000])
  })

  it('ranks learned amounts by frequency', () => {
    for (let i = 0; i < 2; i++) recordAmount(200)
    for (let i = 0; i < 4; i++) recordAmount(1500)
    for (let i = 0; i < 3; i++) recordAmount(80)
    expect(topAmounts()).toEqual([1500, 80, 200])
  })

  it('fills remaining slots with defaults, without duplicates', () => {
    recordAmount(1000)
    recordAmount(1000)
    // 1000 is both learned and a default — it must appear once, first.
    expect(topAmounts()).toEqual([1000, 500, 3000])
  })

  it('respects a custom count', () => {
    for (const amt of [100, 100, 250, 250, 900, 900, 40, 40]) recordAmount(amt)
    expect(topAmounts(2)).toHaveLength(2)
  })
})
