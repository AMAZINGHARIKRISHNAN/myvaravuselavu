import { describe, it, expect } from 'vitest'
import {
  dateKey,
  isJpHoliday,
  isOtherTrip,
  isWeekday,
  isWorkday,
  missingCommuteDays,
  sumTrips,
  tripDisplay,
  claimStage,
  claimRejected,
} from './commute'

// 2026-07-17 is a Friday; 18/19 weekend; 20 is Monday but ALSO Marine Day
// (3rd Monday of July) — a public holiday, so not a workday; 21 Tuesday.
const fri = new Date(2026, 6, 17, 9)
const sat = new Date(2026, 6, 18, 9)
const marineDay = new Date(2026, 6, 20, 9)
const tue = new Date(2026, 6, 21, 9)

describe('missingCommuteDays', () => {
  it('first run logs only today (when a weekday)', () => {
    const days = missingCommuteDays(null, fri)
    expect(days.map(dateKey)).toEqual(['2026-07-17'])
  })

  it('first run on a weekend logs nothing', () => {
    expect(missingCommuteDays(null, sat)).toEqual([])
  })

  it('fills workdays since the marker, skipping weekend AND holidays', () => {
    // Generated through Thursday 16th; opened again on Tuesday 21st →
    // only Friday 17th + Tuesday 21st are missing. Sat/Sun are skipped and
    // so is Monday 20th — Marine Day, no office.
    const days = missingCommuteDays('2026-07-16', tue)
    expect(days.map(dateKey)).toEqual(['2026-07-17', '2026-07-21'])
  })

  it('first run on a public holiday logs nothing', () => {
    expect(missingCommuteDays(null, marineDay)).toEqual([])
  })

  it('does nothing when already up to date', () => {
    expect(missingCommuteDays('2026-07-17', fri)).toEqual([])
  })

  it('caps a long absence at the most recent days', () => {
    const days = missingCommuteDays('2026-01-01', tue, 5)
    expect(days).toHaveLength(5)
    expect(dateKey(days[days.length - 1])).toBe('2026-07-21') // newest kept
  })
})

describe('jp holidays', () => {
  it('knows the fixed and happy-Monday holidays', () => {
    expect(isJpHoliday(new Date(2026, 0, 1, 9))).toBe(true) // New Year
    expect(isJpHoliday(new Date(2026, 6, 20, 9))).toBe(true) // Marine Day
    expect(isJpHoliday(new Date(2026, 4, 4, 9))).toBe(true) // Greenery Day
    expect(isJpHoliday(new Date(2026, 6, 17, 9))).toBe(false) // plain Friday
  })

  it('applies the substitute-Monday rule', () => {
    // 2026-02-11 National Foundation Day is a Wednesday — no substitute.
    expect(isJpHoliday(new Date(2026, 1, 12, 9))).toBe(false)
    // 2027-02-23 falls on Tuesday; 2025-02-23 (Sunday) pushed to Mon 24th.
    expect(isJpHoliday(new Date(2025, 1, 23, 9))).toBe(true)
    expect(isJpHoliday(new Date(2025, 1, 24, 9))).toBe(true)
  })

  it('isWorkday = weekday and not a holiday', () => {
    expect(isWorkday(fri)).toBe(true)
    expect(isWorkday(sat)).toBe(false)
    expect(isWorkday(marineDay)).toBe(false)
  })
})

describe('helpers', () => {
  it('isWeekday', () => {
    expect(isWeekday(fri)).toBe(true)
    expect(isWeekday(sat)).toBe(false)
  })

  it('sumTrips totals amounts', () => {
    expect(sumTrips([{ amount: 280 }, { amount: 280 }, {}])).toBe(560)
  })
})

describe('other trips', () => {
  it('identifies personal outings by leg', () => {
    expect(isOtherTrip({ leg: 'other' })).toBe(true)
    expect(isOtherTrip({ leg: 'toOffice' })).toBe(false)
  })

  it('labels commute legs and personal outings', () => {
    expect(tripDisplay({ leg: 'toOffice' })).toEqual({ emoji: '🌅', label: 'Bus to office' })
    expect(tripDisplay({ leg: 'other', purpose: 'Mall' })).toEqual({ emoji: '🧳', label: 'Mall' })
    expect(tripDisplay({ leg: 'other' }).label).toBe('Other trip')
  })
})

describe('claimStage', () => {
  it('walks draft → submitted → approved → paid', () => {
    expect(claimStage({ status: 'draft' })).toBe('draft')
    expect(claimStage({ status: 'submitted' })).toBe('submitted')
    expect(claimStage({ status: 'approved' })).toBe('approved')
    expect(claimStage({ status: 'paid' })).toBe('paid')
  })

  it('treats anything unrecognised, including the old "pending", as submitted', () => {
    expect(claimStage({ status: 'pending' })).toBe('submitted')
    expect(claimStage({})).toBe('submitted')
  })

  it('reads a legacy approved-with-payment claim as already paid', () => {
    expect(claimStage({ status: 'approved', incomeId: 'i1' })).toBe('paid')
    expect(claimStage({ status: 'approved', receivedVia: 'salary' })).toBe('paid')
  })

  it('sends a rejected claim back to draft, flagged', () => {
    expect(claimStage({ status: 'rejected' })).toBe('draft')
    expect(claimRejected({ status: 'rejected' })).toBe(true)
    expect(claimRejected({ status: 'draft' })).toBe(false)
  })

  it('reopening a paid claim only sticks if BOTH payment traces are cleared', () => {
    const paid = { status: 'paid', incomeId: 'i1', receivedVia: 'separate' }
    // What "money didn't arrive" writes back:
    expect(claimStage({ ...paid, status: 'approved', incomeId: null, receivedVia: null })).toBe(
      'approved'
    )
    // Leaving either one behind would silently keep it "paid".
    expect(claimStage({ ...paid, status: 'approved', incomeId: null })).toBe('paid')
    expect(claimStage({ ...paid, status: 'approved', receivedVia: null })).toBe('paid')
  })
})

// 国民の休日: a weekday with a holiday on both sides is a holiday too. Missing
// it meant the auto-log booked a commute (and a mirrored expense) on a day the
// office was closed, then offered it to the office as a claim.
describe('sandwiched-day holidays (Silver Week)', () => {
  it('2026-09-22 is a holiday, between Respect for the Aged and the Equinox', () => {
    expect(isJpHoliday(new Date(2026, 8, 21, 9))).toBe(true) // 3rd Monday
    expect(isJpHoliday(new Date(2026, 8, 22, 9))).toBe(true) // sandwiched
    expect(isJpHoliday(new Date(2026, 8, 23, 9))).toBe(true) // Autumnal Equinox
  })

  it('auto-log treats it as a day off', () => {
    expect(isWorkday(new Date(2026, 8, 22, 9))).toBe(false)
  })

  it('2032-09-21 is the same pattern', () => {
    expect(isJpHoliday(new Date(2032, 8, 21, 9))).toBe(true)
  })

  it('does not invent one when the gap is wider than a day', () => {
    // 2025: 15 Sept and 23 Sept, nothing in between is a holiday.
    for (let day = 16; day <= 22; day++) {
      expect(isJpHoliday(new Date(2025, 8, day, 9))).toBe(false)
    }
  })

  it('leaves the substitute-Monday rule alone', () => {
    // 2024: the Equinox fell on Sunday 22 Sept, so Monday 23rd is a substitute.
    expect(isJpHoliday(new Date(2024, 8, 22, 9))).toBe(true)
    expect(isJpHoliday(new Date(2024, 8, 23, 9))).toBe(true)
    // …and the Monday after Respect for the Aged Day is still a normal workday.
    expect(isWorkday(new Date(2024, 8, 17, 9))).toBe(true)
  })
})
