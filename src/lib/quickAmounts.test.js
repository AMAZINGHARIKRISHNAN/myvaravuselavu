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
// Amounts are bucketed by currency now — ¥270 and ₹270 are different sums.
const savedJP = () => saved().JP || {}

describe('recordAmount', () => {
  it('counts repeated amounts', () => {
    recordAmount(500)
    recordAmount(500)
    recordAmount(1200)
    expect(savedJP()).toEqual({ 500: 2, 1200: 1 })
  })

  it('rounds to whole units', () => {
    recordAmount(499.6)
    expect(savedJP()).toEqual({ 500: 1 })
  })

  it('ignores zero, negative, and non-numeric amounts', () => {
    recordAmount(0)
    recordAmount(-300)
    recordAmount('abc')
    recordAmount(null)
    expect(savedJP()).toEqual({})
  })

  it('caps the map at 50 amounts, keeping the most frequent', () => {
    // 60 distinct amounts, each logged once…
    for (let i = 1; i <= 60; i++) recordAmount(i * 10)
    // …then one favourite logged many times.
    for (let i = 0; i < 5; i++) recordAmount(999)
    const entries = savedJP()
    expect(Object.keys(entries).length).toBeLessThanOrEqual(50)
    expect(entries[999]).toBe(5)
  })

  it('survives corrupt stored JSON', () => {
    store.set(KEY, '{not json')
    recordAmount(700)
    expect(savedJP()).toEqual({ 700: 1 })
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

// ¥270 is a bus fare; ₹270 is a very different afternoon. Keeping both in one
// bucket meant a run of yen entries filled the rupee chips with yen figures
// wearing a ₹ sign — a wrong number one tap away.
describe('amounts are learned per currency', () => {
  it('keeps yen and rupee amounts apart', () => {
    recordAmount(270, 'JP')
    recordAmount(270, 'JP')
    recordAmount(45, 'IN')
    recordAmount(45, 'IN')
    expect(topAmounts(3, 'JP')[0]).toBe(270)
    expect(topAmounts(3, 'IN')[0]).toBe(45)
    expect(topAmounts(3, 'IN')).not.toContain(270)
  })

  it('offers each currency its own sensible defaults', () => {
    expect(topAmounts(3, 'JP')).toEqual([500, 1000, 3000])
    expect(topAmounts(3, 'IN')).toEqual([100, 500, 1000])
  })

  it('defaults to yen, as the rest of the app does', () => {
    recordAmount(880)
    recordAmount(880)
    expect(topAmounts(3, 'JP')).toContain(880)
  })

  it('keeps paise on a rupee amount rather than rounding it away', () => {
    recordAmount(99.5, 'IN')
    recordAmount(99.5, 'IN')
    expect(topAmounts(3, 'IN')[0]).toBe(99.5)
  })

  it('still rounds yen, which has no subunit', () => {
    recordAmount(499.6, 'JP')
    expect(savedJP()).toEqual({ 500: 1 })
  })

  it('adopts amounts saved before the split as yen, never as rupees', () => {
    // What an existing install has on disk today.
    store.set(KEY, JSON.stringify({ 270: 4, 760: 3 }))
    expect(topAmounts(2, 'JP')).toEqual([270, 760])
    expect(topAmounts(2, 'IN')).toEqual([100, 500])
  })

  it('does not lose the migrated amounts when a new one is recorded', () => {
    store.set(KEY, JSON.stringify({ 270: 4 }))
    recordAmount(310, 'JP')
    expect(savedJP()[270]).toBe(4)
    expect(savedJP()[310]).toBe(1)
  })
})
