import { describe, it, expect } from 'vitest'
import { tagTripOps, selectionSummary, selectedRecords, alreadyTagged } from './tripTagging'
import { tripExpenses } from './trips'
import { summarise } from './trips'

const ROWS = [
  { id: 'e1', amount: 3000, category: 'Food', paymentMethod: 'Edenred', date: new Date(2026, 7, 2) },
  { id: 'e2', amount: 1200, category: 'Transport', paymentMethod: 'Pasmo', date: new Date(2026, 7, 2) },
  { id: 'e3', amount: 1500, category: 'Food', paymentMethod: 'UPI', country: 'IN', date: new Date(2026, 7, 3) },
  { id: 'e4', amount: 9000, category: 'Shopping', paymentMethod: 'MUFJ', date: new Date(2026, 7, 4) },
]

describe('putting existing spending onto a trip', () => {
  it('writes one update per record, and nothing else', () => {
    const ops = tagTripOps(['e1', 'e2'], 'trip-1')
    expect(ops).toEqual([
      { op: 'update', name: 'expenses', id: 'e1', data: { tripId: 'trip-1' } },
      { op: 'update', name: 'expenses', id: 'e2', data: { tripId: 'trip-1' } },
    ])
  })

  // The amount, the currency and the account are never in the payload. A trip
  // is a lens: tagging must not be able to move a single figure.
  it('touches no field but the trip', () => {
    for (const op of tagTripOps(['e1'], 'trip-1')) {
      expect(Object.keys(op.data)).toEqual(['tripId'])
    }
  })

  it('takes records off a trip with a null id', () => {
    expect(tagTripOps(['e1'], null)).toEqual([
      { op: 'update', name: 'expenses', id: 'e1', data: { tripId: null } },
    ])
  })

  it('ignores repeats and blanks rather than writing them twice', () => {
    expect(tagTripOps(['e1', 'e1', '', null, undefined], 'trip-1')).toHaveLength(1)
    expect(tagTripOps([], 'trip-1')).toEqual([])
    expect(tagTripOps(undefined, 'trip-1')).toEqual([])
  })
})

describe('what the selection adds up to', () => {
  it('keeps the two currencies apart', () => {
    expect(selectionSummary(ROWS)).toEqual({ count: 4, totals: { JP: 13200, IN: 1500 } })
  })

  // countryOf, not the stored country: the card decides.
  it('reads the currency from the payment method', () => {
    const mislabelled = [{ id: 'x', amount: 900, paymentMethod: 'Edenred', country: 'IN' }]
    expect(selectionSummary(mislabelled).totals).toEqual({ JP: 900, IN: 0 })
  })

  it('survives an empty or broken selection', () => {
    expect(selectionSummary([])).toEqual({ count: 0, totals: { JP: 0, IN: 0 } })
    expect(() => selectionSummary([null, undefined])).not.toThrow()
  })
})

describe('picking the selected rows out', () => {
  it('returns the records for the chosen ids', () => {
    expect(selectedRecords(ROWS, new Set(['e2', 'e4'])).map((r) => r.id)).toEqual(['e2', 'e4'])
  })

  it('is empty when nothing is chosen', () => {
    expect(selectedRecords(ROWS, new Set())).toEqual([])
    expect(selectedRecords(ROWS, undefined)).toEqual([])
  })
})

// Re-tagging takes spending OFF another trip, and that trip's total drops
// without anybody looking at it. Said out loud before it happens.
describe('warning before a total moves somewhere else', () => {
  it('counts the rows already on a different trip', () => {
    const rows = [{ id: 'a', tripId: 'other' }, { id: 'b' }, { id: 'c', tripId: 'other' }]
    expect(alreadyTagged(rows, 'trip-1')).toEqual({ count: 2, ids: ['a', 'c'] })
  })

  it('says nothing when they are already on this one', () => {
    expect(alreadyTagged([{ id: 'a', tripId: 'trip-1' }], 'trip-1').count).toBe(0)
  })

  it('says nothing about untagged rows', () => {
    expect(alreadyTagged([{ id: 'a' }, { id: 'b' }], 'trip-1').count).toBe(0)
  })
})

// The point of the whole thing: tag, and the trip total is right.
describe('the trip total after tagging', () => {
  it('counts exactly what was put on it, per currency', () => {
    const tagged = ROWS.map((r) =>
      ['e1', 'e2', 'e3'].includes(r.id) ? { ...r, tripId: 'trip-1' } : r
    )
    expect(tripExpenses(tagged, 'trip-1').map((r) => r.id)).toEqual(['e1', 'e2', 'e3'])

    const trip = { id: 'trip-1', name: 'Fukuoka', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 5) }
    const [summary] = summarise([trip], tagged)
    expect(summary.totals.JP).toBe(4200) // 3,000 + 1,200 — the 9,000 was not tagged
    expect(summary.totals.IN).toBe(1500)
  })
})
