import { describe, it, expect } from 'vitest'
import {
  activeTrip,
  isActive,
  onTrip,
  perDay,
  searchUntagged,
  summarise,
  tagOps,
  tripExpenses,
  tripLength,
  tripTotals,
  trueCost,
  untagOps,
  untaggedInRange,
} from './trips'

const day = (n) => new Date(2026, 8, n, 12) // September 2026
const osaka = { id: 't1', name: 'Osaka', startDate: day(10), endDate: day(13) }

const spend = (id, amount, extra = {}) => ({
  id,
  amount,
  category: 'Food',
  date: day(11),
  ...extra,
})

describe('what belongs to a trip', () => {
  it('counts only what is tagged to it', () => {
    const expenses = [
      spend('a', 1200, { tripId: 't1' }),
      spend('b', 800, { tripId: 't2' }),
      spend('c', 500),
    ]
    expect(tripExpenses(expenses, 't1').map((e) => e.id)).toEqual(['a'])
  })

  it('never matches on a missing id', () => {
    expect(onTrip({ tripId: undefined }, undefined)).toBe(false)
    expect(onTrip({}, 't1')).toBe(false)
    expect(onTrip(null, 't1')).toBe(false)
  })

  // The rent falling mid-holiday is the reason tagging is explicit. Dates alone
  // would sweep it in and there would be no way to argue with the total.
  it('does not sweep in an untagged expense just because the dates overlap', () => {
    const rent = spend('rent', 60000, { category: 'Bills', date: day(11) })
    expect(tripExpenses([rent], 't1')).toEqual([])
  })
})

describe('a trip that is running', () => {
  it('is active on its first and last day', () => {
    expect(isActive(osaka, day(10))).toBe(true)
    expect(isActive(osaka, day(13))).toBe(true)
  })

  // The end date is a DAY, not a moment. Dinner at 9pm on the last night is
  // still the holiday.
  it('includes the whole of the last day, not just midday', () => {
    expect(isActive(osaka, new Date(2026, 8, 13, 23, 59))).toBe(true)
    expect(isActive(osaka, new Date(2026, 8, 14, 0, 1))).toBe(false)
  })

  it('is not active before it starts or after it ends', () => {
    expect(isActive(osaka, day(9))).toBe(false)
    expect(isActive(osaka, day(20))).toBe(false)
  })

  it('treats a trip with no end as still running', () => {
    expect(isActive({ startDate: day(10) }, day(40))).toBe(true)
  })

  it('is never active without a start', () => {
    expect(isActive({ endDate: day(13) }, day(11))).toBe(false)
    expect(isActive(null, day(11))).toBe(false)
  })

  it('picks the most recently started when two overlap', () => {
    const trips = [osaka, { id: 't2', name: 'Kyoto', startDate: day(12), endDate: day(15) }]
    expect(activeTrip(trips, day(12)).id).toBe('t2')
  })

  it('finds nothing when nothing is running', () => {
    expect(activeTrip([osaka], day(1))).toBe(null)
    expect(activeTrip([], day(1))).toBe(null)
    expect(activeTrip()).toBe(null)
  })
})

describe('offering what to tag', () => {
  const expenses = [
    spend('before', 300, { date: day(9) }),
    spend('during1', 1200, { date: day(10) }),
    spend('during2', 900, { date: day(13) }),
    spend('after', 400, { date: day(14) }),
    spend('already', 500, { date: day(11), tripId: 't1' }),
  ]

  it('offers the untagged expenses inside the dates', () => {
    expect(untaggedInRange(expenses, osaka).map((e) => e.id)).toEqual(['during1', 'during2'])
  })

  it('never re-offers something already tagged, even to another trip', () => {
    const taken = [spend('x', 100, { date: day(11), tripId: 't2' })]
    expect(untaggedInRange(taken, osaka)).toEqual([])
  })

  it('offers nothing for a trip with no start date', () => {
    expect(untaggedInRange(expenses, { endDate: day(13) })).toEqual([])
  })

  it('builds one update per expense, and skips rows it cannot address', () => {
    const ops = tagOps([{ id: 'a' }, { amount: 5 }, { id: 'b' }], 't1')
    expect(ops).toEqual([
      { op: 'update', name: 'expenses', id: 'a', data: { tripId: 't1' } },
      { op: 'update', name: 'expenses', id: 'b', data: { tripId: 't1' } },
    ])
  })

  // Clearing writes null rather than deleting: the field must exist to be
  // cleared, and null reads the same as absent everywhere that checks it.
  it('clears a tag by writing null', () => {
    expect(untagOps([{ id: 'a', tripId: 't1' }, { id: 'b' }], ['a'])).toEqual([
      { op: 'update', name: 'expenses', id: 'a', data: { tripId: null } },
    ])
  })
})

describe('what the trip cost', () => {
  // A trip home spans both currencies: the flight in yen, everything after
  // landing in rupees. One number covering both would be meaningless in either.
  const india = [
    spend('flight', 62000, { tripId: 't1', category: 'Transport', date: day(10) }),
    spend('airport', 1800, { tripId: 't1', category: 'Food', date: day(10) }),
    spend('taxi', 900, { tripId: 't1', category: 'Transport', country: 'IN', date: day(11) }),
    spend('gifts', 4500, { tripId: 't1', category: 'Gifts', country: 'IN', date: day(12) }),
    spend('notmine', 500, { date: day(11) }),
  ]

  it('keeps the two currencies apart', () => {
    const t = tripTotals(india, 't1')
    expect(t.totals).toEqual({ JP: 63800, IN: 5400 })
    expect(t.count).toBe(4)
  })

  it('breaks each currency down by category on its own', () => {
    const t = tripTotals(india, 't1')
    expect(t.byCategory.JP).toEqual({ Transport: 62000, Food: 1800 })
    expect(t.byCategory.IN).toEqual({ Transport: 900, Gifts: 4500 })
  })

  // A card decides its own currency, so a trip total agrees with every other
  // screen about what is yen.
  it('reads a card expense as yen however it was stored', () => {
    const t = tripTotals(
      [spend('lunch', 900, { tripId: 't1', paymentMethod: 'Edenred', country: 'IN' })],
      't1'
    )
    expect(t.totals).toEqual({ JP: 900, IN: 0 })
  })

  it('counts the distinct days money was actually spent', () => {
    expect(tripTotals(india, 't1').daysSpent).toBe(3)
  })

  it('costs nothing when nothing is tagged', () => {
    expect(tripTotals([], 't1')).toEqual({
      count: 0,
      totals: { JP: 0, IN: 0 },
      byCategory: { JP: {}, IN: {} },
      daysSpent: 0,
    })
  })
})

describe('how long, and how much a day', () => {
  // Three nights is four dates on a calendar. Dividing by the wrong one is
  // quietly a third out on a short trip.
  it('counts both ends of the trip', () => {
    expect(tripLength(osaka)).toBe(4)
    expect(tripLength({ startDate: day(10), endDate: day(10) })).toBe(1)
  })

  it('treats an open-ended trip as a single day so far', () => {
    expect(tripLength({ startDate: day(10) })).toBe(1)
  })

  it('is zero with no start', () => {
    expect(tripLength({})).toBe(0)
    expect(tripLength(null)).toBe(0)
  })

  // A day you paid for nothing is still a day of the holiday; skipping it
  // flatters the average.
  it('divides by the length of the trip, not the days you spent on', () => {
    const totals = { JP: 40000, IN: 0 }
    expect(perDay(osaka, totals).JP).toBe(10000)
  })

  it('never divides by zero', () => {
    expect(perDay({}, { JP: 500, IN: 0 }).JP).toBe(500)
  })
})

describe('the list screen', () => {
  it('gives every trip its figures, newest first', () => {
    const trips = [
      { id: 't1', name: 'Osaka', startDate: day(10), endDate: day(13) },
      { id: 't2', name: 'Kyoto', startDate: day(20), endDate: day(21) },
    ]
    const expenses = [
      spend('a', 1000, { tripId: 't1' }),
      spend('b', 2000, { tripId: 't2', date: day(20) }),
    ]
    const rows = summarise(trips, expenses)
    expect(rows.map((r) => r.name)).toEqual(['Kyoto', 'Osaka'])
    expect(rows[0].totals.JP).toBe(2000)
    expect(rows[1].days).toBe(4)
  })

  it('survives having no trips at all', () => {
    expect(summarise()).toEqual([])
    expect(summarise([], [])).toEqual([])
  })
})

// The scenario this was built against: a graduation in India, 11 Sep to 4 Oct.
// A ¥131,080 Cathay Pacific ticket booked in July (including ¥4,700 of extra
// baggage), rupee spending once there, and one unpaid day of leave.
describe('a real trip, end to end', () => {
  const india = { id: 'g1', name: 'India — Graduation', startDate: day(11), endDate: new Date(2026, 9, 4, 12) }

  const flight = {
    id: 'f1',
    amount: 131080,
    category: 'Transport',
    note: 'Cathay Pacific — graduation',
    date: new Date(2026, 6, 2, 12), // booked in July, months before the trip
  }
  const inIndia = [
    spend('taxi', 900, { country: 'IN', category: 'Transport', date: new Date(2026, 8, 13, 12) }),
    spend('gifts', 6500, { country: 'IN', category: 'Gifts', date: new Date(2026, 8, 20, 12) }),
  ]
  // One unpaid day. Nothing leaves an account, so it is not an expense.
  const unpaidDay = { id: 'l1', kind: 'unpaidLeave', label: 'Unpaid leave', paid: 14500, recovered: 0 }

  it('cannot find the flight by date, because it was booked months earlier', () => {
    expect(untaggedInRange([flight, ...inIndia], india).map((e) => e.id)).toEqual(['taxi', 'gifts'])
  })

  it('finds it by searching instead', () => {
    expect(searchUntagged([flight, ...inIndia], 'cathay').map((e) => e.id)).toEqual(['f1'])
    expect(searchUntagged([flight], 'graduation')).toHaveLength(1)
    expect(searchUntagged([flight], '131080')).toHaveLength(1)
  })

  it('never offers something already on another trip', () => {
    expect(searchUntagged([{ ...flight, tripId: 'other' }], 'cathay')).toEqual([])
  })

  it('needs more than one character, so it does not dump the whole ledger', () => {
    expect(searchUntagged([flight], 'c')).toEqual([])
    expect(searchUntagged([flight], '')).toEqual([])
  })

  it('separates the yen ticket from the rupees spent there', () => {
    const tagged = [{ ...flight, tripId: 'g1' }, ...inIndia.map((e) => ({ ...e, tripId: 'g1' }))]
    const t = tripTotals(tagged, 'g1')
    expect(t.totals).toEqual({ JP: 131080, IN: 7400 })
  })

  // The point: a trip counted only in spending looks cheaper than it was, by a
  // day's pay.
  it('adds the pay given up to what was spent', () => {
    const tagged = [{ ...flight, tripId: 'g1' }, ...inIndia.map((e) => ({ ...e, tripId: 'g1' }))]
    const cost = trueCost(tagged, [{ ...unpaidDay, tripId: 'g1' }], 'g1')
    expect(cost.spent).toEqual({ JP: 131080, IN: 7400 })
    expect(cost.forgone).toEqual({ JP: 14500, IN: 0 })
    expect(cost.total).toEqual({ JP: 145580, IN: 7400 })
  })

  it('keeps spent and forgone apart, because they are different sentences', () => {
    const cost = trueCost([], [{ ...unpaidDay, tripId: 'g1' }], 'g1')
    expect(cost.spent.JP).toBe(0)
    expect(cost.total.JP).toBe(14500)
  })

  it('ignores a loss belonging to another trip, or to none', () => {
    const losses = [{ ...unpaidDay, tripId: 'other' }, { ...unpaidDay, id: 'l2' }]
    expect(trueCost([], losses, 'g1').forgone).toEqual({ JP: 0, IN: 0 })
  })

  // Recovering more than you lost is a gain, and gains belong on the other
  // side of the Profit page — never a negative cost here.
  it('never turns a recovered loss into a negative cost', () => {
    const refunded = { id: 'l3', tripId: 'g1', paid: 5000, recovered: 9000 }
    expect(trueCost([], [refunded], 'g1').forgone.JP).toBe(0)
  })

  it('counts only what was not recovered', () => {
    const partly = { id: 'l4', tripId: 'g1', paid: 5000, recovered: 2000 }
    expect(trueCost([], [partly], 'g1').forgone.JP).toBe(3000)
  })

  it('costs nothing when nothing is attached', () => {
    expect(trueCost([], [], 'g1')).toEqual({
      spent: { JP: 0, IN: 0 },
      forgone: { JP: 0, IN: 0 },
      total: { JP: 0, IN: 0 },
    })
  })
})
