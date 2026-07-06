import { describe, it, expect } from 'vitest'
import { computeSafeToSpend, gradeForSavingsRate } from './planning'

describe('computeSafeToSpend', () => {
  const now = new Date(2026, 6, 6) // 6 Jul; July has 31 days → 26 days left incl. today

  it('divides what is left over the remaining days', () => {
    const r = computeSafeToSpend({
      expectedIncome: 300000,
      savingsTarget: 50000,
      spent: 40000,
      upcoming: 80000,
      now,
    })
    expect(r.daysLeft).toBe(26)
    expect(r.available).toBe(130000)
    expect(r.perDay).toBe(5000)
  })

  it('clamps per-day to zero when overspent', () => {
    const r = computeSafeToSpend({ expectedIncome: 100000, spent: 150000, now })
    expect(r.available).toBe(-50000)
    expect(r.perDay).toBe(0)
  })

  it('counts the last day of the month as one remaining day', () => {
    const r = computeSafeToSpend({ expectedIncome: 31000, now: new Date(2026, 6, 31) })
    expect(r.daysLeft).toBe(1)
    expect(r.perDay).toBe(31000)
  })
})

describe('gradeForSavingsRate', () => {
  it('maps rates to grades', () => {
    expect(gradeForSavingsRate(0.45)).toBe('A')
    expect(gradeForSavingsRate(0.3)).toBe('B')
    expect(gradeForSavingsRate(0.15)).toBe('C')
    expect(gradeForSavingsRate(0.05)).toBe('D')
    expect(gradeForSavingsRate(-0.1)).toBe('E')
  })

  it('returns null for non-finite input', () => {
    expect(gradeForSavingsRate(NaN)).toBeNull()
    expect(gradeForSavingsRate(Infinity)).toBeNull()
  })
})
