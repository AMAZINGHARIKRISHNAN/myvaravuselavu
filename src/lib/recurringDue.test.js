import { describe, it, expect } from 'vitest'
import { dueDay, dateForDay, isDue, lastDayOfMonth } from './recurringDue'

// The Docomo bill: ¥3,126 taken on the 31st of every month.
const docomo = { active: true, dayOfMonth: 31, lastGeneratedMonth: null }

describe('dueDay', () => {
  it('is the day itself when the month is long enough', () => {
    expect(dueDay(31, new Date(2026, 6, 1))).toBe(31) // July
    expect(dueDay(15, new Date(2026, 1, 1))).toBe(15) // February
  })

  it('falls back to month end in a short month', () => {
    expect(dueDay(31, new Date(2026, 3, 1))).toBe(30) // April
    expect(dueDay(31, new Date(2026, 1, 1))).toBe(28) // February 2026
    expect(dueDay(30, new Date(2026, 1, 1))).toBe(28)
  })

  it('handles a leap February', () => {
    expect(lastDayOfMonth(new Date(2028, 1, 1))).toBe(29)
    expect(dueDay(31, new Date(2028, 1, 1))).toBe(29)
  })

  it('clamps nonsense to a real day', () => {
    expect(dueDay(0, new Date(2026, 6, 1))).toBe(1)
    expect(dueDay(undefined, new Date(2026, 6, 1))).toBe(1)
  })
})

describe('dateForDay', () => {
  it('dates the record the day the money actually moves', () => {
    expect(dateForDay(31, new Date(2026, 6, 15))).toEqual(new Date(2026, 6, 31))
    expect(dateForDay(31, new Date(2026, 1, 15))).toEqual(new Date(2026, 1, 28))
  })
})

describe('isDue', () => {
  it('is not due before the day arrives', () => {
    expect(isDue(docomo, new Date(2026, 6, 30), '2026-07')).toBe(false)
  })

  // The old rule fired on the 28th of every month for a day-31 bill — three
  // days early in July, and the balance was wrong until the money left.
  it('waits for the real 31st in a 31-day month', () => {
    expect(isDue(docomo, new Date(2026, 6, 28), '2026-07')).toBe(false)
    expect(isDue(docomo, new Date(2026, 6, 31), '2026-07')).toBe(true)
  })

  it('still fires in months that have no 31st', () => {
    expect(isDue(docomo, new Date(2026, 3, 30), '2026-04')).toBe(true) // April
    expect(isDue(docomo, new Date(2026, 1, 28), '2026-02')).toBe(true) // February
  })

  it('never posts the same month twice', () => {
    expect(isDue({ ...docomo, lastGeneratedMonth: '2026-07' }, new Date(2026, 6, 31), '2026-07')).toBe(false)
  })

  it('ignores paused items', () => {
    expect(isDue({ ...docomo, active: false }, new Date(2026, 6, 31), '2026-07')).toBe(false)
  })

  it('stays due after the day passes, so a missed month is still caught', () => {
    expect(isDue({ ...docomo, dayOfMonth: 5 }, new Date(2026, 6, 20), '2026-07')).toBe(true)
  })
})
