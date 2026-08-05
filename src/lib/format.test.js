import { describe, it, expect } from 'vitest'
import { startOfDay } from './format'

describe('startOfDay', () => {
  it('pulls a late-evening reconcile point back to midnight of that day', () => {
    const d = startOfDay(new Date(2026, 6, 30, 23, 50))
    expect(d.getHours()).toBe(0)
    expect(d.getDate()).toBe(30)
  })

  it('lets a record stamped 12:00 AM count against an anchor set later that day', () => {
    const anchor = startOfDay(new Date(2026, 6, 30, 23, 50))
    const record = new Date(2026, 6, 30, 0, 0)
    expect(record >= anchor).toBe(true)
  })

  it('still excludes the day before', () => {
    const anchor = startOfDay(new Date(2026, 6, 30, 12))
    expect(new Date(2026, 6, 29, 23, 59) >= anchor).toBe(false)
  })
})

import { toDateTimeInputValue, parseDateTimeInput } from './format'

describe('datetime-local helpers', () => {
  it('formats a Date as local YYYY-MM-DDTHH:mm', () => {
    // Local time, so build the Date locally and compare against local parts.
    const d = new Date(2026, 6, 27, 9, 5) // 27 Jul 2026, 09:05
    expect(toDateTimeInputValue(d)).toBe('2026-07-27T09:05')
  })

  it('round-trips through parse without drifting', () => {
    const d = new Date(2026, 6, 27, 18, 42)
    const back = parseDateTimeInput(toDateTimeInputValue(d))
    expect(back.getFullYear()).toBe(2026)
    expect(back.getMonth()).toBe(6)
    expect(back.getDate()).toBe(27)
    expect(back.getHours()).toBe(18)
    expect(back.getMinutes()).toBe(42)
  })

  it('falls back to a date-only string with no time part', () => {
    const back = parseDateTimeInput('2026-07-27')
    expect(back.getFullYear()).toBe(2026)
    expect(back.getMonth()).toBe(6)
    expect(back.getDate()).toBe(27)
  })
})
