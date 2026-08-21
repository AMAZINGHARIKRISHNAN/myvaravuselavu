import { describe, it, expect } from 'vitest'
import {
  tripByDay,
  busiestDay,
  tripByMethod,
  topExpenses,
  categoryShares,
  untaggedDuring,
} from './tripAnalytics'
import { tripTotals } from './trips'

const day = (d) => new Date(2026, 7, d, 12)
const TRIP = { id: 't1', name: 'Fukuoka', startDate: day(10), endDate: day(13) }

const EXPENSES = [
  { id: 'a', tripId: 't1', amount: 3000, category: 'Food', paymentMethod: 'Edenred', date: day(10) },
  { id: 'b', tripId: 't1', amount: 12000, category: 'Fun', paymentMethod: 'MUFJ', date: day(11) },
  { id: 'c', tripId: 't1', amount: 1500, category: 'Food', paymentMethod: 'Edenred', date: day(11) },
  // Day 12 is deliberately empty.
  { id: 'd', tripId: 't1', amount: 800, category: 'Transport', paymentMethod: 'Pasmo', date: day(13) },
  // Rupees on the same trip — a border crossing, kept apart throughout.
  { id: 'e', tripId: 't1', amount: 2500, category: 'Food', paymentMethod: 'UPI', date: day(12) },
  // Booked before the trip: on the trip, but not on one of its days.
  { id: 'f', tripId: 't1', amount: 40000, category: 'Transport', paymentMethod: 'MUFJ', date: day(1) },
  // Not on the trip at all, but inside its dates — rent, and it should stay off.
  { id: 'g', amount: 60000, category: 'Bills', paymentMethod: 'MUFJ', date: day(11) },
]

describe('spending day by day', () => {
  const days = tripByDay(EXPENSES, TRIP)

  it('covers every day of the trip, including the quiet ones', () => {
    expect(days).toHaveLength(4)
    expect(days.map((d) => d.date.getDate())).toEqual([10, 11, 12, 13])
  })

  // The empty day is the point: a gap is information about the journey.
  it('shows a day with nothing spent as zero, not as missing', () => {
    const twelfth = days.find((d) => d.date.getDate() === 12)
    expect(twelfth.JP).toBe(0)
    expect(twelfth.IN).toBe(2500)
  })

  it('keeps the two currencies apart', () => {
    expect(days.find((d) => d.date.getDate() === 11)).toMatchObject({ JP: 13500, IN: 0, count: 2 })
  })

  // A flight booked in July belongs to a September trip's total, but not to any
  // of its days — putting it on day one would invent a spike.
  it('leaves a purchase made before the trip out of the curve', () => {
    expect(days.reduce((s, d) => s + d.JP, 0)).toBe(17300) // 3,000 + 13,500 + 800
    // …while the trip's own total still counts it.
    expect(tripTotals(EXPENSES, 't1').totals.JP).toBe(57300)
  })

  it('runs an unfinished trip up to today', () => {
    const open = { id: 't1', startDate: day(10) }
    expect(tripByDay(EXPENSES, open, { now: day(12) })).toHaveLength(3)
  })

  it('says nothing about a trip with no start date', () => {
    expect(tripByDay(EXPENSES, { id: 't1' })).toEqual([])
  })
})

describe('the day that took the most', () => {
  it('finds it, per currency', () => {
    const days = tripByDay(EXPENSES, TRIP)
    expect(busiestDay(days, 'JP').date.getDate()).toBe(11)
    expect(busiestDay(days, 'IN').date.getDate()).toBe(12)
  })

  it('is null when nothing was spent in that currency', () => {
    expect(busiestDay(tripByDay([], TRIP), 'JP')).toBe(null)
    expect(busiestDay([], 'JP')).toBe(null)
  })
})

describe('which card carried the trip', () => {
  it('ranks the methods by what went through them', () => {
    const methods = tripByMethod(EXPENSES, 't1')
    expect(methods[0]).toMatchObject({ label: 'MUFJ', JP: 52000, count: 2 })
    expect(methods.map((m) => m.label)).toEqual(['MUFJ', 'Edenred', 'UPI', 'Pasmo'])
  })

  // A record with no card is a hole in the analysis and has to be visible.
  it('names records with no card rather than dropping them', () => {
    const methods = tripByMethod([{ tripId: 't1', amount: 500, date: day(10) }], 't1')
    expect(methods[0]).toMatchObject({ label: 'Not recorded', JP: 500 })
  })
})

describe('the biggest purchases', () => {
  it('lists them largest first', () => {
    expect(topExpenses(EXPENSES, 't1', { limit: 3 }).map((e) => e.id)).toEqual(['f', 'b', 'a'])
  })

  it('copes with a trip that has nothing on it', () => {
    expect(topExpenses(EXPENSES, 'nope')).toEqual([])
  })
})

describe('each category as a share of the whole', () => {
  it('works out what dominated', () => {
    const shares = categoryShares({ Food: 60, Fun: 30, Transport: 10 })
    expect(shares[0]).toMatchObject({ category: 'Food', amount: 60, share: 0.6 })
    expect(shares.map((s) => s.category)).toEqual(['Food', 'Fun', 'Transport'])
  })

  it('never divides by zero', () => {
    expect(categoryShares({})).toEqual([])
    expect(categoryShares({ Food: 0 })).toEqual([])
  })
})

// The reliability figure: every total is only as good as what was tagged.
describe('what was spent in these dates but left off the trip', () => {
  it('totals it, so the trip total can be trusted or questioned', () => {
    expect(untaggedDuring(EXPENSES, TRIP)).toMatchObject({ count: 1, JP: 60000, IN: 0 })
  })

  it('ignores anything outside the dates', () => {
    const outside = [{ amount: 999, paymentMethod: 'MUFJ', date: day(20) }]
    expect(untaggedDuring(outside, TRIP).count).toBe(0)
  })

  it('counts the last day of the trip as part of it', () => {
    const lastNight = [{ amount: 500, paymentMethod: 'MUFJ', date: new Date(2026, 7, 13, 21) }]
    expect(untaggedDuring(lastNight, TRIP).count).toBe(1)
  })

  it('says nothing without a start date', () => {
    expect(untaggedDuring(EXPENSES, {})).toMatchObject({ count: 0 })
  })
})
