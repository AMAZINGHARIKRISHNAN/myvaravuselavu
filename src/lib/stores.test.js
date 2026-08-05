import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeStore,
  storeKey,
  recordStore,
  topStores,
  rankStores,
  storeCoverage,
} from './stores'

describe('normalizeStore', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeStore('  Family   Mart  ')).toBe('Family Mart')
  })

  it('handles missing values', () => {
    expect(normalizeStore(undefined)).toBe('')
    expect(normalizeStore(null)).toBe('')
  })

  it('caps runaway input', () => {
    expect(normalizeStore('x'.repeat(200))).toHaveLength(60)
  })
})

describe('storeKey', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(storeKey('7-Eleven')).toBe(storeKey('7 eleven'))
    expect(storeKey('Family Mart')).toBe(storeKey('familymart'))
  })

  it('keeps non-Latin scripts', () => {
    expect(storeKey('セブンイレブン')).toBe('セブンイレブン')
  })
})

describe('recordStore / topStores', () => {
  // Node test env has no localStorage — back it with an in-memory map.
  beforeEach(() => {
    const store = new Map()
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    }
  })

  it('ranks by how often a store was used', () => {
    recordStore('Lawson')
    recordStore('Lawson')
    recordStore('Don Quijote')
    expect(topStores()).toEqual(['Lawson', 'Don Quijote'])
  })

  it('merges spellings and keeps the latest casing', () => {
    recordStore('lawson')
    recordStore('Lawson')
    expect(topStores()).toEqual(['Lawson'])
  })

  it('ignores blank names', () => {
    recordStore('   ')
    expect(topStores()).toEqual([])
  })
})

describe('rankStores', () => {
  const expenses = [
    { store: 'Lawson', amount: 500 },
    { store: 'lawson ', amount: 300 },
    { store: 'Don Quijote', amount: 2000 },
    { store: '', amount: 900 },
    { amount: 100 },
  ]

  it('totals spend per store, biggest first', () => {
    expect(rankStores(expenses)).toEqual([
      { name: 'Don Quijote', total: 2000, count: 1 },
      { name: 'lawson', total: 800, count: 2 },
    ])
  })

  it('skips untagged expenses instead of bucketing them', () => {
    expect(rankStores(expenses).some((s) => s.name === 'Unknown')).toBe(false)
  })

  it('respects the limit', () => {
    expect(rankStores(expenses, { limit: 1 })).toHaveLength(1)
  })
})

describe('storeCoverage', () => {
  it('reports the tagged share', () => {
    expect(storeCoverage([{ store: 'Lawson' }, { store: '' }])).toBe(0.5)
  })

  it('treats an empty list as fully covered so no nudge shows', () => {
    expect(storeCoverage([])).toBe(1)
  })
})
