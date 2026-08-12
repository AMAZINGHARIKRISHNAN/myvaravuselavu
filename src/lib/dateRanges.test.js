import { describe, it, expect, vi, afterEach } from 'vitest'
import { monthRange, currentMonthRange, lastNMonthsRange, currentYearRange } from './dateRanges'

afterEach(() => {
  vi.useRealTimers()
})

describe('dateRanges', () => {
  it('monthRange(0) covers the current month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15)) // 2026-07-15
    const range = monthRange(0)
    expect(range.start).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0))
    expect(range.end.getMonth()).toBe(6)
    expect(range.end.getDate()).toBe(31)
    expect(range.key).toBe('2026-07')
  })

  it('monthRange(1) covers the previous month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15))
    const range = monthRange(1)
    expect(range.key).toBe('2026-06')
    expect(range.end.getDate()).toBe(30)
  })

  it('does not overflow when today is the 31st', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 31)) // Jul 31; June has 30 days
    expect(monthRange(1).key).toBe('2026-06')
  })

  it('lastNMonthsRange spans n calendar months', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15))
    const range = lastNMonthsRange(6)
    expect(range.start).toEqual(new Date(2026, 1, 1, 0, 0, 0, 0)) // Feb 1
    expect(range.end.getMonth()).toBe(6)
  })

  it('currentMonthRange and currentYearRange bound today', () => {
    const now = new Date()
    const m = currentMonthRange()
    const y = currentYearRange()
    expect(m.start <= now && now <= m.end).toBe(true)
    expect(y.start.getMonth()).toBe(0)
    expect(y.end.getMonth()).toBe(11)
  })
})

// The helpers take the clock so a screen can depend on the day changing.
// Reaching for new Date() internally meant a useMemo built on them froze at
// whatever moment the installed PWA was first opened.
describe('ranges are computed from the clock they are given', () => {
  const newYearsEve = new Date(2026, 11, 31, 23, 59)
  const newYearsDay = new Date(2027, 0, 1, 0, 1)

  it('monthRange follows the date passed in', () => {
    expect(monthRange(0, newYearsEve).key).toBe('2026-12')
    expect(monthRange(0, newYearsDay).key).toBe('2027-01')
    expect(monthRange(1, newYearsDay).key).toBe('2026-12')
  })

  it('currentMonthRange rolls over at midnight', () => {
    expect(currentMonthRange(newYearsEve).start.getMonth()).toBe(11)
    expect(currentMonthRange(newYearsDay).start.getMonth()).toBe(0)
    expect(currentMonthRange(newYearsDay).start.getFullYear()).toBe(2027)
  })

  it('currentYearRange rolls over too', () => {
    expect(currentYearRange(newYearsEve).start.getFullYear()).toBe(2026)
    expect(currentYearRange(newYearsDay).start.getFullYear()).toBe(2027)
  })

  it('lastNMonthsRange counts back from the date given', () => {
    const r = lastNMonthsRange(6, newYearsDay)
    expect(r.start.getFullYear()).toBe(2026)
    expect(r.start.getMonth()).toBe(7) // August
    expect(r.end.getMonth()).toBe(0)
  })

  it('still defaults to now when no clock is passed', () => {
    expect(monthRange(0).key).toBe(monthRange(0, new Date()).key)
  })
})
