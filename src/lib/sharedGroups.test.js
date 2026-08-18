import { describe, it, expect } from 'vitest'
import { balanceLog, computeGroupReport, mirrorEditOps, settleSuggestions } from './sharedGroups'

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

// The expense and its group mirror used to be updated in two separate awaits.
// A failure between them left the personal record and the group's split maths
// disagreeing about the same purchase.
describe('editing an expense mirrored into a group', () => {
  const payload = { amount: 3200, store: 'Aeon', date: new Date('2026-08-15T12:00:00Z'), country: 'JP', paymentMethod: 'MUFJ' }

  it('puts both sides in one list, so one commit covers them', () => {
    const ops = mirrorEditOps({ expenseId: 'e1', groupEntryId: 'g1', payload, item: 'Groceries' })
    expect(ops).toHaveLength(2)
    expect(ops.map((o) => o.name)).toEqual(['expenses', 'groupExpenses'])
    expect(ops.every((o) => o.op === 'update')).toBe(true)
  })

  it('carries the new amount to the ledger, which is what the split reads', () => {
    const [, mirror] = mirrorEditOps({ expenseId: 'e1', groupEntryId: 'g1', payload, item: 'Groceries' })
    expect(mirror.data.amount).toBe(3200)
    expect(mirror.data.item).toBe('Groceries')
    expect(mirror.data.date).toBe(payload.date)
  })

  // The ledger splits a number between people; it has no use for how the payer
  // happened to pay, and copying it would only invite the two to disagree.
  it('does not push payment method or country into the ledger', () => {
    const [, mirror] = mirrorEditOps({ expenseId: 'e1', groupEntryId: 'g1', payload, item: 'x' })
    expect(mirror.data.paymentMethod).toBeUndefined()
    expect(mirror.data.country).toBeUndefined()
  })

  it('is a single op when the expense has no group mirror', () => {
    const ops = mirrorEditOps({ expenseId: 'e1', groupEntryId: null, payload, item: 'x' })
    expect(ops).toEqual([{ op: 'update', name: 'expenses', id: 'e1', data: payload }])
  })

  it('does nothing without an expense to edit', () => {
    expect(mirrorEditOps({ expenseId: null, groupEntryId: 'g1', payload, item: 'x' })).toEqual([])
  })

  // Composed guarantee: this returns ONE list, and commitOps commits a list
  // all-or-nothing (firestore.test.js, "commits nothing when a data function
  // throws" / "surfaces a failed commit"). So a mid-edit failure changes
  // neither side — there is no longer a point between the two writes to fail at.
  it('leaves no gap between the two writes to fail in', () => {
    const ops = mirrorEditOps({ expenseId: 'e1', groupEntryId: 'g1', payload, item: 'x' })
    expect(ops).toHaveLength(2) // one list, therefore one commit
  })
})
