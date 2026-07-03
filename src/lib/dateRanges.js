import { startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, format } from 'date-fns'

// monthsAgo: 0 = current month, 1 = last month, etc.
export function monthRange(monthsAgo = 0) {
  const d = subMonths(new Date(), monthsAgo)
  return {
    start: startOfMonth(d),
    end: endOfMonth(d),
    key: format(d, 'yyyy-MM'),
    label: format(d, 'MMMM yyyy'),
  }
}

export function currentMonthRange() {
  const now = new Date()
  return { start: startOfMonth(now), end: endOfMonth(now) }
}

export function lastNMonthsRange(n) {
  const now = new Date()
  return { start: startOfMonth(subMonths(now, n - 1)), end: endOfMonth(now) }
}

export function currentYearRange() {
  const now = new Date()
  return { start: startOfYear(now), end: endOfYear(now) }
}

export function previousMonthRange() {
  const prev = subMonths(new Date(), 1)
  return { start: startOfMonth(prev), end: endOfMonth(prev) }
}
