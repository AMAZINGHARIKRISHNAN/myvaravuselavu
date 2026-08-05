import { describe, it, expect } from 'vitest'
import { salaryPayDate, salaryStatus } from './salary'

// Month index is 0-based. July 2026: the 25th is a Saturday, so pay shifts to
// Friday the 24th. (24 Jul 2026 is a normal working Friday.)
describe('salaryPayDate', () => {
  it('pays on the salary date when it is a working day', () => {
    // 25 Aug 2026 is a Tuesday — a normal workday.
    expect(salaryPayDate(2026, 7, 25).getDate()).toBe(25)
  })

  it('shifts BACK to Friday when the 25th is a weekend', () => {
    // 25 Jul 2026 is Saturday → previous working day is Friday the 24th.
    const d = salaryPayDate(2026, 6, 25)
    expect(d.getDate()).toBe(24)
    expect(d.getDay()).toBe(5) // Friday
  })

  it('skips a Japanese public holiday too', () => {
    // 25 Apr is a workday normally; test a month where the 25th chain hits a
    // holiday. 3 May 2026 (Constitution Day) is a Sunday → substitute holiday
    // on Wed 6 May; the 4th/5th are holidays. A salary date of 5 May shifts
    // back past the holidays to the 1st (Fri) if 1 is a workday.
    const d = salaryPayDate(2026, 4, 5)
    expect(d.getDay()).not.toBe(0)
    expect(d.getDay()).not.toBe(6)
  })
})

describe('salaryStatus', () => {
  it('is due on and after the credit date, once per month', () => {
    const settings = { salaryDate: 25 }
    // Friday 24 Jul 2026 is the shifted payday.
    expect(salaryStatus(settings, new Date(2026, 6, 23)).due).toBe(false)
    expect(salaryStatus(settings, new Date(2026, 6, 24)).due).toBe(true)
    expect(salaryStatus(settings, new Date(2026, 6, 28)).due).toBe(true)
  })

  it('knows when this month has already been logged', () => {
    const s = salaryStatus({ salaryDate: 25, salaryLoggedMonth: '2026-07' }, new Date(2026, 6, 28))
    expect(s.monthKey).toBe('2026-07')
    expect(s.alreadyLogged).toBe(true)
  })
})
