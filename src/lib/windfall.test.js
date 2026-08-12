import { describe, it, expect } from 'vitest'
import { windfallProfit, splitWindfalls, windfallKind } from './windfall'

describe('windfallProfit', () => {
  it('is the whole payout when none of it was your money', () => {
    // Cancelling a Pasmo the office had effectively funded: pure gain.
    expect(windfallProfit({ received: 56000, cost: 0 })).toBe(56000)
    expect(windfallProfit({ received: 56000 })).toBe(56000)
  })

  it('nets out when the payout was your own money coming back', () => {
    expect(windfallProfit({ received: 56000, cost: 56000 })).toBe(0)
  })

  it('handles a partial cost basis', () => {
    expect(windfallProfit({ received: 56000, cost: 20000 })).toBe(36000)
  })
})

describe('splitWindfalls', () => {
  it('keeps promised money out of the realized total', () => {
    const out = splitWindfalls([
      { received: 56000, cost: 0, date: new Date('2026-07-20') },
      { received: 3000, cost: 0, status: 'pending', date: new Date('2026-07-21') },
    ])
    expect(out.realized).toBe(56000)
    expect(out.pending).toBe(3000)
    expect(out.realizedCount).toBe(1)
    expect(out.pendingCount).toBe(1)
  })

  it('skips break-even entries entirely', () => {
    const out = splitWindfalls([{ received: 5000, cost: 5000, date: new Date() }])
    expect(out.realizedCount).toBe(0)
  })
})

describe('windfallKind', () => {
  it('adds up profit across entries', () => {
    expect([{ received: 500 }, { received: 1000, cost: 200 }]
      .reduce((s, w) => s + windfallProfit(w), 0)).toBe(1300)
  })

  it('falls back to Other for an unknown kind', () => {
    expect(windfallKind('cardRefund').emoji).toBe('💳')
    expect(windfallKind('nope').key).toBe('other')
  })
})
