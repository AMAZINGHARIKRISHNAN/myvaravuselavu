import { describe, it, expect } from 'vitest'
import { setMethodOps, currencyChanges, missingMethod } from './bulkEdit'
import { currencyMismatches } from './currencyAudit'
import { countryOf } from './money'

const ACCOUNTS = [
  { id: 'a1', label: 'MUFJ', country: 'JP' },
  { id: 'a2', label: 'ICICI', country: 'IN' },
]
const ROWS = [
  { id: 'e1', amount: 900, category: 'Food', country: 'JP' },
  { id: 'e2', amount: 1200, category: 'Food', country: 'JP' },
  { id: 'e3', amount: 450, category: 'Snacks', paymentMethod: 'Pasmo', country: 'JP' },
]

describe('putting a payment method on many records at once', () => {
  it('writes the method and the currency it implies, together', () => {
    expect(setMethodOps(ROWS.slice(0, 2), 'ICICI', ACCOUNTS)).toEqual([
      { op: 'update', name: 'expenses', id: 'e1', data: { paymentMethod: 'ICICI', country: 'IN' } },
      { op: 'update', name: 'expenses', id: 'e2', data: { paymentMethod: 'ICICI', country: 'IN' } },
    ])
  })

  it('takes a fixed card at its word', () => {
    expect(setMethodOps([ROWS[0]], 'Edenred', ACCOUNTS)[0].data).toEqual({
      paymentMethod: 'Edenred',
      country: 'JP',
    })
  })

  // Cash is the one method that holds both. Writing a country from it would be
  // inventing an answer, so the record keeps the one it had.
  it('leaves the currency alone when the method cannot name one', () => {
    expect(setMethodOps([ROWS[0]], 'Cash', ACCOUNTS)[0].data).toEqual({ paymentMethod: 'Cash' })
  })

  it('touches no other field', () => {
    for (const op of setMethodOps(ROWS, 'MUFJ', ACCOUNTS)) {
      expect(Object.keys(op.data).sort()).toEqual(['country', 'paymentMethod'])
    }
  })

  it('ignores repeats, blanks and a missing method', () => {
    expect(setMethodOps([ROWS[0], ROWS[0]], 'MUFJ', ACCOUNTS)).toHaveLength(1)
    expect(setMethodOps([{ amount: 5 }], 'MUFJ', ACCOUNTS)).toEqual([])
    expect(setMethodOps(ROWS, '', ACCOUNTS)).toEqual([])
    expect(setMethodOps(ROWS, null, ACCOUNTS)).toEqual([])
  })
})

// Moving records between two totals that must never be added together is not
// something to discover afterwards.
describe('warning when the currency would move', () => {
  it('counts the records that would change currency, and says to which', () => {
    expect(currencyChanges(ROWS, 'ICICI', ACCOUNTS)).toEqual({ count: 3, to: 'IN' })
  })

  it('says nothing when they are already that currency', () => {
    expect(currencyChanges(ROWS, 'MUFJ', ACCOUNTS)).toEqual({ count: 0, to: 'JP' })
  })

  it('says nothing for a method that cannot decide', () => {
    expect(currencyChanges(ROWS, 'Cash', ACCOUNTS)).toEqual({ count: 0, to: null })
  })
})

describe('finding the rows with no method on them', () => {
  it('picks out exactly the ones showing a dash', () => {
    expect(missingMethod(ROWS).map((r) => r.id)).toEqual(['e1', 'e2'])
  })

  it('survives a broken list', () => {
    expect(() => missingMethod([null, undefined, {}])).not.toThrow()
  })
})

// The whole point: a record that had no method must come out of this as one the
// auditor is happy with.
describe('a corrected record passes the currency audit', () => {
  it('agrees with the auditor for every method offered', () => {
    for (const method of ['MUFJ', 'ICICI', 'Pasmo', 'UPI', 'Edenred']) {
      const [op] = setMethodOps([ROWS[0]], method, ACCOUNTS)
      const fixed = { ...ROWS[0], ...op.data }
      expect(currencyMismatches({ expenses: [fixed] }, ACCOUNTS)).toEqual([])
      // And countryOf agrees with what was written.
      expect(countryOf(fixed)).toBe(fixed.country)
    }
  })
})
