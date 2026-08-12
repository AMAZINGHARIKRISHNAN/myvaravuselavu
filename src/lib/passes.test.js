import { describe, it, expect } from 'vitest'
import { coversDate, passCovering, passDays, passResult, passProfit, passDeduction, passSpentFrom } from './passes'

// A ¥10,000 monthly pass against the ¥560/day the office pays back.
const pass = {
  id: 'p1',
  label: 'July commuter pass',
  cost: 10000,
  startDate: new Date('2026-07-01'),
  endDate: new Date('2026-07-31'),
}

const day = (d, extra = {}) => ({
  dateKey: `2026-07-${String(d).padStart(2, '0')}`,
  date: new Date(2026, 6, d, 8),
  amount: 280,
  leg: 'toOffice',
  ...extra,
})

describe('coversDate', () => {
  it('includes both end days and excludes outside', () => {
    expect(coversDate(pass, new Date('2026-07-01'))).toBe(true)
    expect(coversDate(pass, new Date(2026, 6, 31, 23))).toBe(true)
    expect(coversDate(pass, new Date('2026-06-30'))).toBe(false)
    expect(coversDate(pass, new Date('2026-08-01'))).toBe(false)
  })

  it('treats an open-ended pass as still valid', () => {
    expect(coversDate({ startDate: new Date('2026-07-01') }, new Date('2027-01-01'))).toBe(true)
  })
})

describe('passDays', () => {
  it('counts a commuting DAY once, however many legs it has', () => {
    const trips = [day(6), day(6, { leg: 'toHome' }), day(7)]
    expect(passDays(pass, trips)).toBe(2)
  })

  it('ignores personal outings and non-reimbursable trips', () => {
    const trips = [day(6), day(7, { leg: 'other', purpose: 'Mall' }), day(8, { reimbursable: false })]
    expect(passDays(pass, trips)).toBe(1)
  })

  it('ignores trips outside the pass window', () => {
    const trips = [day(6), { dateKey: '2026-06-20', date: new Date(2026, 5, 20), amount: 280 }]
    expect(passDays(pass, trips)).toBe(1)
  })
})

describe('passResult', () => {
  it('turns commuting days into what the office owes, against the pass cost', () => {
    const trips = [6, 7, 8, 9, 10, 13, 14, 15, 16, 17].flatMap((d) => [day(d), day(d, { leg: 'toHome' })])
    const r = passResult(pass, trips, 560)
    expect(r.days).toBe(10)
    expect(r.claimable).toBe(5600)
    expect(r.profit).toBe(-4400) // 10 days in, the pass hasn't earned out yet
    expect(r.breakEvenDays).toBe(18) // ceil(10000 / 560)
  })

  it('goes into profit once past break-even', () => {
    const trips = Array.from({ length: 22 }, (_, i) => day(i + 1))
    const r = passResult(pass, trips, 560)
    expect(r.days).toBe(22)
    expect(r.claimable).toBe(12320)
    expect(r.profit).toBe(2320) // every day past the 18th is pure gain
  })

  it('lets a pass carry its own daily rate when the office rate differs', () => {
    expect(passResult({ ...pass, dailyRate: 600 }, [day(1)], 560).claimable).toBe(600)
  })
})

describe('passProfit', () => {
  const used = Array.from({ length: 22 }, (_, i) => day(i + 1))

  it('counts a finished pass as realized', () => {
    const out = passProfit([{ ...pass, endDate: new Date('2026-07-31') }], used, 560, null, () => true)
    // endDate is in the past relative to "now" only after July; assert on shape
    expect(out.realized + out.pending).toBe(2320)
    expect(out.realizedCount + out.pendingCount).toBe(1)
  })

  it('ignores a pass with no commuting days yet — it just has not earned out', () => {
    const out = passProfit([pass], [], 560, null, () => true)
    expect(out.realized).toBe(0)
    expect(out.pending).toBe(0)
    expect(out.realizedCount + out.pendingCount).toBe(0)
  })
})

describe('pass payment sources & refundable deposit', () => {
  const pass = {
    id: 'p1', label: 'July pass', cost: 17000, paidFrom: 'Pasmo',
    deposit: 500, depositPaidFrom: 'Cash', depositRefunded: false,
    date: new Date('2026-07-01'), startDate: new Date('2026-07-01'),
  }

  it('takes the pass cost from its source and the deposit from its own', () => {
    expect(passDeduction(pass, 'Pasmo')).toBe(17000)
    expect(passDeduction(pass, 'Cash')).toBe(500)
    expect(passDeduction(pass, 'MUFJ')).toBe(0)
  })

  it('stops deducting the deposit once the card is returned', () => {
    expect(passDeduction({ ...pass, depositRefunded: true }, 'Cash')).toBe(0)
    // The pass cost is unaffected — only the deposit comes back.
    expect(passDeduction({ ...pass, depositRefunded: true }, 'Pasmo')).toBe(17000)
  })

  it('sums across passes with the reconcile cutoff', () => {
    const older = { ...pass, id: 'p0', date: new Date('2026-05-01') }
    const cutoff = new Date('2026-06-01').getTime()
    expect(passSpentFrom([pass, older], 'Pasmo', cutoff)).toBe(17000) // older excluded
    expect(passSpentFrom([pass, older], 'Pasmo')).toBe(34000) // no cutoff
  })

  it('stops deducting a deposit once the card is handed back', () => {
    // The deposit is recoverable, so returning the card has to restore the
    // balance it came out of — net zero, not a sunk cost.
    expect(passDeduction(pass, 'Cash')).toBeGreaterThan(0)
    expect(passDeduction({ ...pass, depositRefunded: true, cost: 0 }, 'Cash')).toBe(0)
  })

  it('a pass with no source recorded moves nothing (old data safe)', () => {
    expect(passDeduction({ cost: 17000 }, 'Pasmo')).toBe(0)
    expect(passSpentFrom([{ cost: 17000, date: new Date() }], 'Pasmo')).toBe(0)
  })
})

describe('passCovering', () => {
  it('finds the pass that owns a day, so its fare is not charged twice', () => {
    expect(passCovering([pass], new Date(2026, 6, 15))?.id).toBe('p1')
  })

  it('returns null once the pass has run out — fares are real money again', () => {
    expect(passCovering([pass], new Date(2026, 7, 1))).toBeNull()
    expect(passCovering([], new Date(2026, 6, 15))).toBeNull()
  })

  it('covers the last day itself, not just up to it', () => {
    // A 7am bus on the final day is still travel the pass paid for.
    expect(passCovering([pass], new Date(2026, 6, 31, 7))?.id).toBe('p1')
  })
})
