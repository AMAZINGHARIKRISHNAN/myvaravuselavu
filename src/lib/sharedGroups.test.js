import { describe, it, expect } from 'vitest'
import { computeGroupReport, settleSuggestions, balanceLog } from './sharedGroups'

const MEMBERS = ['Hari', 'Roommate']

describe('computeGroupReport', () => {
  it('splits a single expense equally between two members', () => {
    const report = computeGroupReport(MEMBERS, [
      { type: 'expense', amount: 3000, paidBy: 'Hari' },
    ])
    expect(report.total).toBe(3000)
    expect(report.members.Hari).toEqual({ paid: 3000, share: 1500, net: 1500 })
    expect(report.members.Roommate).toEqual({ paid: 0, share: 1500, net: -1500 })
  })

  it('nets out when both members spend', () => {
    const report = computeGroupReport(MEMBERS, [
      { type: 'expense', amount: 4000, paidBy: 'Hari' },
      { type: 'expense', amount: 1000, paidBy: 'Roommate' },
    ])
    // Total 5000 → each owes 2500. Hari fronted 4000 → is owed 1500.
    expect(report.total).toBe(5000)
    expect(report.members.Hari.net).toBe(1500)
    expect(report.members.Roommate.net).toBe(-1500)
  })

  it('applies settlements without adding to spending', () => {
    const report = computeGroupReport(MEMBERS, [
      { type: 'expense', amount: 4000, paidBy: 'Hari' },
      { type: 'settlement', amount: 2000, paidBy: 'Roommate', to: 'Hari' },
    ])
    expect(report.total).toBe(4000) // settlement is not spending
    expect(report.members.Hari.net).toBe(0)
    expect(report.members.Roommate.net).toBe(0)
  })

  it('splits equally among three members', () => {
    const report = computeGroupReport(['A', 'B', 'C'], [
      { type: 'expense', amount: 900, paidBy: 'A' },
    ])
    expect(report.members.A.net).toBe(600)
    expect(report.members.B.net).toBe(-300)
    expect(report.members.C.net).toBe(-300)
  })

  it('ignores entries from members no longer in the group', () => {
    const report = computeGroupReport(MEMBERS, [
      { type: 'expense', amount: 1000, paidBy: 'Ghost' },
    ])
    // Ghost's payment credits no one, but the spend still splits.
    expect(report.total).toBe(1000)
    expect(report.members.Hari.net).toBe(-500)
  })
})

describe('settleSuggestions', () => {
  it('tells the debtor to pay the creditor', () => {
    const report = computeGroupReport(MEMBERS, [
      { type: 'expense', amount: 4000, paidBy: 'Hari' },
      { type: 'expense', amount: 1000, paidBy: 'Roommate' },
    ])
    expect(settleSuggestions(report)).toEqual([
      { from: 'Roommate', to: 'Hari', amount: 1500 },
    ])
  })

  it('suggests nothing when everyone is square', () => {
    const report = computeGroupReport(MEMBERS, [
      { type: 'expense', amount: 2000, paidBy: 'Hari' },
      { type: 'expense', amount: 2000, paidBy: 'Roommate' },
    ])
    expect(settleSuggestions(report)).toEqual([])
  })

  it('treats sub-yen crumbs from odd splits as settled', () => {
    const report = computeGroupReport(['A', 'B', 'C'], [
      { type: 'expense', amount: 1000, paidBy: 'A' },
      { type: 'settlement', amount: 333, paidBy: 'B', to: 'A' },
      { type: 'settlement', amount: 333, paidBy: 'C', to: 'A' },
    ])
    expect(settleSuggestions(report)).toEqual([])
  })

  it('chains transfers for three unbalanced members', () => {
    const report = computeGroupReport(['A', 'B', 'C'], [
      { type: 'expense', amount: 3000, paidBy: 'A' },
    ])
    const transfers = settleSuggestions(report)
    expect(transfers).toHaveLength(2)
    expect(transfers.every((t) => t.to === 'A' && t.amount === 1000)).toBe(true)
  })
})

describe('balanceLog', () => {
  it('shows alternating purchases tallying against each other', () => {
    // Day 1 Hari buys 3000, day 2 Roommate buys 2000 → running goes
    // +1500 then back down to +500, and matches the report's net.
    const entries = [
      { type: 'expense', amount: 3000, paidBy: 'Hari', date: new Date('2026-07-01') },
      { type: 'expense', amount: 2000, paidBy: 'Roommate', date: new Date('2026-07-02') },
    ]
    const log = balanceLog(MEMBERS, entries, 'Hari')
    expect(log.map((r) => r.delta)).toEqual([1500, -1000])
    expect(log.map((r) => r.running)).toEqual([1500, 500])
    expect(log[1].running).toBe(computeGroupReport(MEMBERS, entries).members.Hari.net)
  })

  it('sorts the log by date and applies settlements', () => {
    const entries = [
      { type: 'settlement', amount: 500, paidBy: 'Roommate', to: 'Hari', date: new Date('2026-07-03') },
      { type: 'expense', amount: 1000, paidBy: 'Hari', date: new Date('2026-07-01') },
    ]
    const log = balanceLog(MEMBERS, entries, 'Hari')
    expect(log[0].entry.type).toBe('expense') // earlier date first
    expect(log.map((r) => r.running)).toEqual([500, 0])
  })

  it('omits entries that do not touch this member', () => {
    const entries = [
      { type: 'settlement', amount: 500, paidBy: 'B', to: 'C', date: new Date('2026-07-01') },
      { type: 'expense', amount: 900, paidBy: 'A', date: new Date('2026-07-02') },
    ]
    const log = balanceLog(['A', 'B', 'C'], entries, 'A')
    expect(log).toHaveLength(1) // B→C settlement is invisible to A
    expect(log[0].delta).toBe(600)
  })
})
