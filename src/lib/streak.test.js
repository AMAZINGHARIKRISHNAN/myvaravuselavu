import { describe, it, expect } from 'vitest'
import { computeStreak, daysUntilSalary, lastNDaysTotals, todayTotal } from './streak'

const now = new Date(2026, 6, 6) // Mon 6 Jul 2026
const rec = (y, m, d, amount = 100) => ({ date: new Date(y, m, d, 10), amount })

describe('computeStreak', () => {
  it('returns 0 with no records', () => {
    expect(computeStreak([], now)).toBe(0)
  })

  it('counts consecutive days ending today', () => {
    const records = [rec(2026, 6, 6), rec(2026, 6, 5), rec(2026, 6, 4)]
    expect(computeStreak(records, now)).toBe(3)
  })

  it('gives today as grace when not yet logged', () => {
    const records = [rec(2026, 6, 5), rec(2026, 6, 4)]
    expect(computeStreak(records, now)).toBe(2)
  })

  it('breaks on a gap', () => {
    const records = [rec(2026, 6, 6), rec(2026, 6, 4)]
    expect(computeStreak(records, now)).toBe(1)
  })

  it('counts across month boundaries', () => {
    const records = [rec(2026, 6, 1), rec(2026, 5, 30), rec(2026, 5, 29)]
    expect(computeStreak(records, new Date(2026, 6, 1))).toBe(3)
  })
})

describe('daysUntilSalary', () => {
  it('returns days until this month’s salary day', () => {
    expect(daysUntilSalary(25, now)).toBe(19)
  })

  it('returns 0 on salary day', () => {
    expect(daysUntilSalary(6, now)).toBe(0)
  })

  it('rolls to next month when passed', () => {
    expect(daysUntilSalary(1, now)).toBe(26) // 1 Aug 2026
  })

  it('clamps day 31 to short months', () => {
    // From 1 Feb 2026: salary day 31 → 28 Feb (2026 not a leap year)
    expect(daysUntilSalary(31, new Date(2026, 1, 1))).toBe(27)
  })

  it('returns null when unset', () => {
    expect(daysUntilSalary(0, now)).toBeNull()
    expect(daysUntilSalary(null, now)).toBeNull()
  })
})

describe('lastNDaysTotals', () => {
  it('returns n buckets oldest to newest with sums', () => {
    const records = [rec(2026, 6, 6, 500), rec(2026, 6, 6, 200), rec(2026, 6, 3, 300)]
    const out = lastNDaysTotals(records, 7, now)
    expect(out).toHaveLength(7)
    expect(out[6]).toEqual({ key: '2026-07-06', value: 700 })
    expect(out[3]).toEqual({ key: '2026-07-03', value: 300 })
    expect(out[0].value).toBe(0)
  })
})

describe('todayTotal', () => {
  it('sums only today’s records', () => {
    const records = [rec(2026, 6, 6, 450), rec(2026, 6, 5, 999)]
    expect(todayTotal(records, now)).toBe(450)
  })
})
