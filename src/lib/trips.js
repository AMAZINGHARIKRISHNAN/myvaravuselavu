// Trips: what one journey actually cost.
//
// NOT a group. A group answers "who owes whom" — members, splits, settling up.
// A trip answers "what did this cost me": one person, many categories, bounded
// in time. Modelling a trip as a one-member group would give a settle-up screen
// permanently reading "all square" and no dates to bound it with.
//
// A trip is an extra LENS on spending, never a second ledger. Every expense on
// a trip stays in the month, the budgets and the savings rate exactly as
// before — it is real money that really left. The trip only groups it.
import { toDate, startOfDay } from './format'
import { countryOf } from './money'

// An expense belongs to a trip when it SAYS it does.
//
// The alternative — "anything dated inside the trip" — quietly sweeps in the
// rent and the phone bill if they fall mid-journey, and there is no way to
// argue with it. A stored id is unambiguous and can be corrected one row at a
// time.
export const onTrip = (record, tripId) => Boolean(tripId) && record?.tripId === tripId

export function tripExpenses(expenses = [], tripId) {
  return expenses.filter((e) => onTrip(e, tripId))
}

const time = (v) => {
  const d = toDate(v)
  return d ? d.getTime() : null
}

// The last instant of the day a trip ends on.
//
// Dates are stored at noon, so "end + 24 hours" reached lunchtime the FOLLOWING
// day and quietly counted a day too many. The end date names a day, and the
// whole of that day belongs to the trip — dinner at 9pm on the last night is
// still the holiday.
const DAY = 24 * 60 * 60 * 1000
const lastInstant = (endDate) => {
  const end = toDate(endDate)
  return end ? startOfDay(end).getTime() + DAY - 1 : Infinity
}

// Is this trip running today? An active trip is what lets new spending tag
// itself, which is the difference between a total you trust and one you
// remember to maintain.
export function isActive(trip, now = new Date()) {
  const start = time(trip?.startDate)
  if (start === null) return false
  const t = now.getTime()
  return t >= startOfDay(new Date(start)).getTime() && t <= lastInstant(trip?.endDate)
}

// The trip currently running, if any. Newest start wins when two overlap —
// the later one is the one you just began.
export function activeTrip(trips = [], now = new Date()) {
  return (
    [...trips]
      .filter((t) => isActive(t, now))
      .sort((a, b) => (time(b.startDate) ?? 0) - (time(a.startDate) ?? 0))[0] || null
  )
}

// Expenses dated inside the trip that are not yet tagged to it.
//
// Offered rather than applied: this is the list a screen shows so you can
// untick the rent before it joins the holiday.
export function untaggedInRange(expenses = [], trip) {
  const start = time(trip?.startDate)
  if (start === null) return []
  const from = startOfDay(new Date(start)).getTime()
  const to = lastInstant(trip?.endDate)
  return expenses.filter((e) => {
    if (e.tripId) return false
    const t = time(e.date)
    return t !== null && t >= from && t <= to
  })
}

export const tagOps = (expenses = [], tripId) =>
  expenses
    .filter((e) => e.id)
    .map((e) => ({ op: 'update', name: 'expenses', id: e.id, data: { tripId } }))

// Removing a tag writes null, not a delete: the field has to exist to be
// cleared, and null reads the same as absent everywhere that checks it.
export const untagOps = (expenses = [], ids = []) =>
  expenses
    .filter((e) => e.id && ids.includes(e.id))
    .map((e) => ({ op: 'update', name: 'expenses', id: e.id, data: { tripId: null } }))

// What the trip cost, per currency.
//
// Yen and rupees are never added. A trip home spans both — the flight and the
// airport bought in yen, everything after landing in rupees — and one number
// covering both would be meaningless in either. Each currency gets its own
// total, its own categories and its own daily figure.
export function tripTotals(expenses = [], tripId) {
  const rows = tripExpenses(expenses, tripId)
  const totals = { JP: 0, IN: 0 }
  const byCategory = { JP: {}, IN: {} }
  const days = new Set()

  for (const e of rows) {
    const c = countryOf(e) === 'IN' ? 'IN' : 'JP'
    const amount = e.amount || 0
    totals[c] += amount
    const cat = e.category || 'Other'
    byCategory[c][cat] = (byCategory[c][cat] || 0) + amount
    const d = toDate(e.date)
    if (d) days.add(d.toDateString())
  }

  return { count: rows.length, totals, byCategory, daysSpent: days.size }
}

// How many days the trip covers, inclusive of both ends — "3 nights" is four
// dates on a calendar, and a per-day figure divided by the wrong one is
// quietly off by a third on a short trip.
export function tripLength(trip) {
  const start = time(trip?.startDate)
  const end = time(trip?.endDate)
  if (start === null) return 0
  if (end === null) return 1
  return Math.max(1, Math.round((end - start) / DAY) + 1)
}

// Spend per day, per currency. Divided by the LENGTH OF THE TRIP, not by the
// days you happened to spend money on: a day you paid for nothing is still a
// day of the holiday, and skipping it flatters the average.
export function perDay(trip, totals) {
  const days = tripLength(trip) || 1
  return { JP: totals.JP / days, IN: totals.IN / days }
}

// Every trip with its figures, newest first — the list screen in one call.
export function summarise(trips = [], expenses = []) {
  return [...trips]
    .map((trip) => {
      const t = tripTotals(expenses, trip.id)
      return { ...trip, ...t, perDay: perDay(trip, t.totals), days: tripLength(trip) }
    })
    .sort((a, b) => (time(b.startDate) ?? 0) - (time(a.startDate) ?? 0))
}
