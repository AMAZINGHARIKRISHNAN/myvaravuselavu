import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeStore,
  storeKey,
  recordStore,
  topStores,
  rankStores,
  storeCoverage,
  storeMemory,
  storeProfiles,
  mergeStoreMemory,
  cashCurrency,
  rankMethods,
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

// What makes terse entry possible: a shop typed as one word can only come out
// as the right category on the right card if something remembers those.
describe('storeMemory', () => {
  beforeEach(() => {
    const store = new Map()
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    }
  })

  it('remembers the category and the card a shop usually gets', () => {
    recordStore('Cosmos', { category: 'Food', paymentMethod: 'Cash' })
    recordStore('Cosmos', { category: 'Food', paymentMethod: 'Cash' })
    expect(storeMemory()).toEqual([
      { name: 'Cosmos', count: 2, category: 'Food', paymentMethod: 'Cash', country: null },
    ])
  })

  it('reports the usual one, not the most recent', () => {
    recordStore('Lawson', { category: 'Food', paymentMethod: 'Edenred' })
    recordStore('Lawson', { category: 'Food', paymentMethod: 'Edenred' })
    recordStore('Lawson', { category: 'Snacks', paymentMethod: 'Cash' })
    expect(storeMemory()[0]).toMatchObject({ category: 'Food', paymentMethod: 'Edenred' })
  })

  it('remembers which currency a shop was paid in, for cash', () => {
    recordStore('Chai Stall', { category: 'Snacks', paymentMethod: 'Cash', country: 'IN' })
    expect(storeMemory()[0]).toMatchObject({ paymentMethod: 'Cash', country: 'IN' })
  })

  it('says nothing about a shop it has only ever seen bare', () => {
    recordStore('Somewhere New')
    expect(storeMemory()[0]).toMatchObject({ count: 1, category: null, paymentMethod: null })
  })

  // The list on this phone predates the categories being recorded, so every
  // read has to cope with a bare count where an object is now written.
  it('reads a list written before it learned anything', () => {
    localStorage.setItem('vs_store_freq', JSON.stringify({ Lawson: 4, Cosmos: 1 }))
    expect(topStores()).toEqual(['Lawson', 'Cosmos'])
    expect(storeMemory()).toEqual([
      { name: 'Lawson', count: 4, category: null, paymentMethod: null, country: null },
      { name: 'Cosmos', count: 1, category: null, paymentMethod: null, country: null },
    ])
    // And keeps counting from where the old format left off.
    recordStore('Lawson', { category: 'Food' })
    expect(storeMemory()[0]).toMatchObject({ count: 5, category: 'Food' })
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

// ---- What the ledger already knows ------------------------------------------
// The typed list starts empty on a phone that has been used for a year. The
// records have not.
describe('storeProfiles', () => {
  const at = (d) => new Date(2026, 7, d, 12)
  const LEDGER = [
    { store: 'Lawson', category: 'Food', paymentMethod: 'Edenred', date: at(1) },
    { store: 'lawson', category: 'Food', paymentMethod: 'Edenred', date: at(8) },
    { store: 'Lawson ', category: 'Snacks', paymentMethod: 'Cash', date: at(9) },
    { store: 'Cosmos', category: 'Health', paymentMethod: 'nimoca', date: at(3) },
    { store: '', category: 'Food', paymentMethod: 'Cash', date: at(4) },
  ]
  const NOW = new Date(2026, 7, 15, 12)

  it('learns the category and card a shop is actually logged with', () => {
    const cosmos = storeProfiles(LEDGER, { now: NOW }).find((p) => p.name === 'Cosmos')
    expect(cosmos).toMatchObject({ category: 'Health', paymentMethod: 'nimoca' })
  })

  it('merges spellings and offers back the most recent one', () => {
    const names = storeProfiles(LEDGER, { now: NOW }).map((p) => p.name)
    expect(names).toContain('Lawson') // from 'Lawson ', the latest, normalised
    expect(names.filter((n) => n.toLowerCase() === 'lawson')).toHaveLength(1)
  })

  it('ignores records with no shop rather than bucketing them', () => {
    expect(storeProfiles(LEDGER, { now: NOW }).some((p) => !p.name)).toBe(false)
  })

  // A card switched away from a year ago must not outvote this month's.
  it('lets a recent habit outweigh an old one', () => {
    const history = [
      ...Array.from({ length: 4 }, () => ({
        store: 'Aeon', category: 'Food', paymentMethod: 'MUFJ', date: new Date(2025, 1, 1, 12),
      })),
      ...Array.from({ length: 3 }, () => ({
        store: 'Aeon', category: 'Food', paymentMethod: 'Edenred', date: at(10),
      })),
    ]
    expect(storeProfiles(history, { now: NOW })[0].paymentMethod).toBe('Edenred')
  })

  it('reads the currency through the same rule as the rest of the app', () => {
    const rupees = [{ store: 'Reliance', category: 'Food', paymentMethod: 'UPI', date: at(2) }]
    expect(storeProfiles(rupees, { now: NOW })[0].country).toBe('IN')
  })

  // Firestore hands back Timestamps, not Dates. Every fixture above uses a
  // Date, so nothing here had ever read a date in the shape the real records
  // actually arrive in — and the whole feature turns on reading them.
  it('reads a date in the shape Firestore actually returns', () => {
    const stamp = (d) => ({ toDate: () => d, seconds: Math.floor(d.getTime() / 1000) })
    const history = [
      ...Array.from({ length: 4 }, () => ({
        store: 'Aeon', category: 'Food', paymentMethod: 'MUFJ', date: stamp(new Date(2025, 1, 1, 12)),
      })),
      ...Array.from({ length: 3 }, () => ({
        store: 'Aeon', category: 'Food', paymentMethod: 'Edenred', date: stamp(at(10)),
      })),
    ]
    // Recency still wins, which it only can if the Timestamps were understood.
    expect(storeProfiles(history, { now: NOW })[0].paymentMethod).toBe('Edenred')
  })

  it('survives records with nothing on them', () => {
    expect(() => storeProfiles([null, {}, { store: 'x' }], { now: NOW })).not.toThrow()
  })
})

describe('mergeStoreMemory', () => {
  it('lets the first list answer and the second only fill blanks', () => {
    const merged = mergeStoreMemory(
      [{ name: 'Lawson', count: 3, category: 'Food', paymentMethod: null, country: null }],
      [{ name: 'lawson', count: 2, category: 'Snacks', paymentMethod: 'Edenred', country: 'JP' }]
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      name: 'Lawson',
      count: 5,
      category: 'Food', // the first list's answer stands
      paymentMethod: 'Edenred', // the second fills what the first did not know
      country: 'JP',
    })
  })

  it('keeps shops that only one list has ever seen', () => {
    const merged = mergeStoreMemory([{ name: 'A Shop', count: 1 }], [{ name: 'B Shop', count: 9 }])
    expect(merged.map((m) => m.name)).toEqual(['B Shop', 'A Shop'])
  })
})

// The "yen or rupees?" question is only a real question for someone who
// actually spends cash in both.
describe('cashCurrency', () => {
  it('answers for someone whose cash has only ever been yen', () => {
    expect(cashCurrency([
      { paymentMethod: 'Cash', country: 'JP' },
      { paymentMethod: 'Cash' },
      { paymentMethod: 'Edenred', country: 'JP' },
    ])).toBe('JP')
  })

  it('refuses to answer when both have happened', () => {
    expect(cashCurrency([
      { paymentMethod: 'Cash', country: 'JP' },
      { paymentMethod: 'Cash', country: 'IN' },
    ])).toBe(null)
  })

  it('says nothing on a ledger with no cash in it', () => {
    expect(cashCurrency([{ paymentMethod: 'Edenred', country: 'JP' }])).toBe(null)
    expect(cashCurrency([])).toBe(null)
  })
})

describe('rankMethods', () => {
  const LEDGER = [
    { store: 'Lawson', category: 'Food', paymentMethod: 'Edenred' },
    { store: 'Aeon', category: 'Food', paymentMethod: 'MUFJ' },
    { store: 'Aeon', category: 'Food', paymentMethod: 'MUFJ' },
    { store: 'Aeon', category: 'Food', paymentMethod: 'MUFJ' },
  ]

  it('puts what this shop is usually paid with first', () => {
    expect(rankMethods(LEDGER, { category: 'Food', store: 'lawson' })[0]).toBe('Edenred')
  })

  it('falls back to what the category is usually paid with', () => {
    expect(rankMethods(LEDGER, { category: 'Food' })[0]).toBe('MUFJ')
  })

  it('says nothing rather than guessing on an empty ledger', () => {
    expect(rankMethods([], { category: 'Food' })).toEqual([])
  })
})
