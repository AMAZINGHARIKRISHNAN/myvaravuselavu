// Reading a trip, rather than just totalling it.
//
// The trip view already answers "how much" — a total, an average per day, a
// category list. None of that answers "where did it go", which is the question
// somebody actually has after a journey: which day ran away with it, which two
// purchases were half the trip, which card carried it.
//
// Every function here is pure, takes the records it needs, and keeps the two
// currencies apart throughout. A trip that crosses a border has yen days and
// rupee days and there is no honest single number for the pair.
import { toDate, startOfDay } from './format'
import { countryOf } from './money'
import { tripExpenses } from './trips'

const DAY = 24 * 60 * 60 * 1000
const bucket = () => ({ JP: 0, IN: 0, count: 0 })
const addTo = (into, record) => {
  into[countryOf(record) === 'IN' ? 'IN' : 'JP'] += record.amount || 0
  into.count += 1
}

// Spending per calendar day, every day of the trip present — including the ones
// nothing was spent on.
//
// The empty days are the point. A list of only the days with purchases hides
// the rhythm of a journey: three quiet days and one expensive one reads very
// differently from four even ones, and a gap is information.
export function tripByDay(expenses = [], trip, { now = new Date() } = {}) {
  const rows = tripExpenses(expenses, trip?.id)
  const start = toDate(trip?.startDate)
  if (!start) return []

  // An unfinished trip runs to today, not to nowhere.
  const rawEnd = toDate(trip?.endDate) || now
  const from = startOfDay(start).getTime()
  const to = Math.max(from, startOfDay(rawEnd).getTime())

  const byKey = new Map()
  for (let t = from; t <= to; t += DAY) {
    byKey.set(startOfDay(new Date(t)).getTime(), bucket())
  }

  for (const record of rows) {
    const at = toDate(record?.date)
    if (!at) continue
    const key = startOfDay(at).getTime()
    // A flight booked weeks before the trip belongs to the trip but not to one
    // of its days; it is counted in the total and left out of the curve.
    if (!byKey.has(key)) continue
    addTo(byKey.get(key), record)
  }

  return [...byKey.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, totals]) => ({ time, date: new Date(time), ...totals }))
}

// The day that took the most, per currency. Null when nothing was spent.
export function busiestDay(days = [], country = 'JP') {
  let best = null
  for (const day of days) {
    if ((day[country] || 0) <= 0) continue
    if (!best || day[country] > best[country]) best = day
  }
  return best
}

// Which card or account carried the trip, most first.
export function tripByMethod(expenses = [], tripId) {
  const byMethod = new Map()
  for (const record of tripExpenses(expenses, tripId)) {
    const label = record?.paymentMethod || 'Not recorded'
    if (!byMethod.has(label)) byMethod.set(label, { label, ...bucket() })
    addTo(byMethod.get(label), record)
  }
  return [...byMethod.values()].sort((a, b) => b.JP + b.IN - (a.JP + a.IN))
}

// The largest single purchases. Two or three of these are usually most of a
// trip, and they are what a person actually remembers paying for.
export function topExpenses(expenses = [], tripId, { limit = 5 } = {}) {
  return tripExpenses(expenses, tripId)
    .filter((r) => (r?.amount || 0) > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
}

// A category list with each one's share of that currency's total, biggest
// first. The share is what makes it analysable at a glance — "Food 42,000" says
// less than "Food, over half of it".
export function categoryShares(byCategory = {}) {
  const entries = Object.entries(byCategory).filter(([, amount]) => amount > 0)
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0)
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({
      category,
      amount,
      share: total > 0 ? amount / total : 0,
    }))
}

// How much of what you spent during these dates is NOT on the trip.
//
// This is the reliability figure. Every total here is only as good as what was
// tagged, and a trip missing half its purchases will still show a confident
// number. Rent and bills legitimately fall inside the dates and should stay
// off, so this reports rather than judges.
export function untaggedDuring(expenses = [], trip) {
  const start = toDate(trip?.startDate)
  if (!start) return { count: 0, JP: 0, IN: 0 }
  const from = startOfDay(start).getTime()
  const to = startOfDay(toDate(trip?.endDate) || start).getTime() + DAY - 1

  const out = bucket()
  for (const record of expenses) {
    if (record?.tripId) continue
    const at = toDate(record?.date)
    if (!at) continue
    const t = at.getTime()
    if (t < from || t > to) continue
    addTo(out, record)
  }
  return out
}
