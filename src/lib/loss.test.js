import { describe, it, expect } from 'vitest'
import { lossAmount, splitLosses, sortLosses, lossKind } from './loss'
import { profitEvents, buildProfitSources, splitGainLoss } from './profit'

const loss = (over) => ({ id: 'l1', label: 'Fee', paid: 500, recovered: 0, ...over })

describe('lossAmount', () => {
  it('is what you paid minus what came back', () => {
    expect(lossAmount(loss({ paid: 2946, recovered: 2610 }))).toBe(336)
  })

  it('is the whole thing when nothing came back', () => {
    expect(lossAmount(loss({ paid: 500 }))).toBe(500)
  })

  // Recovering more than you paid is a gain, and gains belong on the other
  // side of the page — never as a negative loss quietly inflating the total.
  it('never goes negative', () => {
    expect(lossAmount(loss({ paid: 500, recovered: 900 }))).toBe(0)
  })

  it('sums a list', () => {
    expect([loss({ paid: 500 }), loss({ paid: 2946, recovered: 2610 })]
      .reduce((s, l) => s + lossAmount(l), 0)).toBe(836)
  })
})

describe('splitLosses', () => {
  it('separates written-off money from what you are still disputing', () => {
    const out = splitLosses([
      loss({ id: 'a', paid: 500, status: 'written-off' }),
      loss({ id: 'b', paid: 300, status: 'disputed' }),
    ])
    expect(out.realized).toBe(500)
    expect(out.realizedCount).toBe(1)
    expect(out.pending).toBe(300)
    expect(out.pendingCount).toBe(1)
  })

  it('skips losses that netted to nothing', () => {
    expect(splitLosses([loss({ paid: 500, recovered: 500 })]).realizedCount).toBe(0)
  })

  it('honours a date range', () => {
    const july = { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31, 23, 59, 59) }
    const inRange = (value, range) => !range || (value >= range.start && value <= range.end)
    const out = splitLosses(
      [loss({ paid: 500, date: new Date(2026, 6, 5) }), loss({ id: 'l2', paid: 900, date: new Date(2026, 5, 5) })],
      july,
      inRange
    )
    expect(out.realized).toBe(500)
  })
})

describe('losses in the profit pipeline', () => {
  const base = {
    claims: [
      // The Ayase case: ¥2,946 spent, only ¥2,610 approved.
      { id: 'c1', name: 'Ayase visit', status: 'paid', claimedAmount: 2946, approvedAmount: 2610, paidAt: new Date('2026-07-31') },
    ],
    losses: [{ id: 'l1', label: 'ATM fee', kind: 'fee', paid: 220, recovered: 0, date: new Date('2026-07-20') }],
  }

  it('carries a logged loss as a negative event', () => {
    const e = profitEvents(base).find((x) => x.id === 'loss-l1')
    expect(e.amount).toBe(-220)
    expect(e.icon).toBe(lossKind('fee').emoji)
  })

  it('counts a claim approved below cost as a loss, not a gain', () => {
    const { gained, lost, net } = splitGainLoss(profitEvents(base))
    expect(gained).toBe(0)
    expect(lost).toBe(556) // 336 short-paid + 220 fee
    expect(net).toBe(-556)
  })

  it('holds a disputed loss apart from what is already gone', () => {
    const { lost, pendingLoss } = splitGainLoss(
      profitEvents({ losses: [loss({ paid: 400, status: 'disputed', date: new Date('2026-07-02') })] })
    )
    expect(lost).toBe(0)
    expect(pendingLoss).toBe(400)
  })

  it('shows losses as their own rollup row and drags the total down', () => {
    const { sources, total } = buildProfitSources(base)
    const row = sources.find((s) => s.key === 'losses')
    expect(row.amount).toBe(-220)
    expect(total).toBe(-556) // the row plus the claim shortfall
  })

  it('still reconciles: every event adds up to the rollup total', () => {
    const events = profitEvents(base).filter((e) => !e.pending && e.country !== 'IN')
    expect(events.reduce((s, e) => s + e.amount, 0)).toBe(buildProfitSources(base).total)
  })
})

describe('sortLosses', () => {
  it('puts the newest first', () => {
    const rows = sortLosses([
      loss({ id: 'old', date: new Date('2026-06-01') }),
      loss({ id: 'new', date: new Date('2026-07-01') }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['new', 'old'])
  })
})
