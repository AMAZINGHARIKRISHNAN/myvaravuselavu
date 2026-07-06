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
