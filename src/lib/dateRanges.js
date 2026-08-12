import { toDate } from './format'
import { startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, format } from 'date-fns'

// Every helper here takes the clock rather than reaching for it. Screens pass
// the value from useToday(), which changes once a day — so a memo built on a
// range depends on something that visibly moves, instead of being frozen on an
// empty dependency array at whatever moment the app was first opened. That
// matters because this app is installed and rarely closed: "this month" has to
// become the new month at midnight without a reload.

// monthsAgo: 0 = current month, 1 = last month, etc.
export function monthRange(monthsAgo = 0, now = new Date()) {
  const d = subMonths(now, monthsAgo)
  return {
    start: startOfMonth(d),
    end: endOfMonth(d),
    key: format(d, 'yyyy-MM'),
    label: format(d, 'MMMM yyyy'),
  }
}

export function currentMonthRange(now = new Date()) {
  return { start: startOfMonth(now), end: endOfMonth(now) }
}

export function lastNMonthsRange(n, now = new Date()) {
  return { start: startOfMonth(subMonths(now, n - 1)), end: endOfMonth(now) }
}

export function currentYearRange(now = new Date()) {
  return { start: startOfYear(now), end: endOfYear(now) }
}

// Records inside a date window, sliced from a collection already in memory.
//
// Every range used to be its own Firestore query, which meant the same
// collection was fetched several times over: the Dashboard held all-time
// expenses (for the balances and glance strip), this month's, and last
// month's — three reads of one collection on one screen, where the first
// contains the other two.
//
// Slicing locally makes the extra reads unnecessary and changing month free:
// no query, no skeleton, no quota. `end` is INCLUSIVE, matching the Firestore
// `where('date', '<=', end)` it replaces.
//
// A record with no date is left out of every range, exactly as the query did —
// Firestore never returns documents missing the field being ordered on.
export function withinRange(records = [], range) {
  if (!range?.start && !range?.end) return records
  const from = range.start ? range.start.getTime() : -Infinity
  const to = range.end ? range.end.getTime() : Infinity
  return records.filter((r) => {
    const d = toDate(r.date)
    if (!d) return false
    const t = d.getTime()
    return t >= from && t <= to
  })
}
