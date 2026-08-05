import { describe, it, expect } from 'vitest'
import {
  itemIssues,
  claimableLines,
  reportLines,
  sumLines,
  reimbursementSummary,
  sumRequested,
  lineMarkup,
  RECEIPT_REQUIRED_ABOVE,
} from './reimburse'

const today = new Date('2026-07-23')

describe('itemIssues', () => {
  const ok = { amount: 1200, purpose: 'Team lunch', date: new Date('2026-07-20') }

  it('passes a complete small expense with no receipt', () => {
    expect(itemIssues(ok, today)).toEqual([])
  })

  it('demands a receipt only above the policy limit', () => {
    const big = { ...ok, amount: RECEIPT_REQUIRED_ABOVE + 1 }
    expect(itemIssues(big, today).map((i) => i.key)).toEqual(['receipt'])
    expect(itemIssues({ ...big, receipt: 'data:image/jpeg;base64,x' }, today)).toEqual([])
  })

  it('flags a missing business purpose, accepting a plain note as one', () => {
    expect(itemIssues({ ...ok, purpose: '' }, today).map((i) => i.key)).toEqual(['purpose'])
    expect(itemIssues({ ...ok, purpose: '', note: 'client visit' }, today)).toEqual([])
  })

  it('flags amounts and stale dates', () => {
    const out = itemIssues({ amount: 0, purpose: 'x', date: new Date('2026-01-01') }, today)
    expect(out.map((i) => i.key)).toEqual(['amount', 'stale'])
  })
})

describe('claimableLines', () => {
  const items = [
    { id: 'a', item: 'Printer paper', amount: 1200, purpose: 'Office', date: new Date('2026-07-20') },
    { id: 'b', item: 'Taxi', amount: 3000, claimId: 'r1', date: new Date('2026-07-19') },
    { id: 'c', item: 'Old', amount: 500, status: 'received', date: new Date('2026-06-01') },
  ]
  const trips = [
    { id: 't1', dateKey: '2026-07-21', amount: 280, date: new Date('2026-07-21'), method: 'Pasmo' },
    { id: 't2', dateKey: '2026-07-21', amount: 280, date: new Date('2026-07-21'), method: 'Pasmo' },
    { id: 't3', dateKey: '2026-07-18', amount: 280, date: new Date('2026-07-18'), claimId: 'r1' },
    { id: 't4', dateKey: '2026-07-17', amount: 280, date: new Date('2026-07-17'), reimbursable: false },
  ]

  it('collects unclaimed items and rolls commute trips up per day', () => {
    const lines = claimableLines({ items, trips })
    expect(lines.map((l) => l.id)).toEqual(['commute-2026-07-21', 'a']) // newest first
    const commute = lines[0]
    expect(commute.amount).toBe(560) // both legs of the day, one line
    expect(commute.tripIds).toEqual(['t1', 't2'])
  })

  it('leaves out anything already on a report, received, or not reimbursable', () => {
    const ids = claimableLines({ items, trips }).map((l) => l.id)
    expect(ids).not.toContain('b')
    expect(ids).not.toContain('c')
    expect(ids.some((id) => id.includes('2026-07-17'))).toBe(false)
  })

  it('sums to the money you are owed but have not filed', () => {
    expect(sumLines(claimableLines({ items, trips }))).toBe(1200 + 560)
  })

  it('buckets dateKey-less trips by local day, not UTC', () => {
    // 7:30am JST on the 21st is still the 20th in UTC — both legs of this
    // commute must land on one 07-21 line, not split across two days.
    const legacy = [
      { id: 'x1', amount: 280, date: new Date(2026, 6, 21, 7, 30) },
      { id: 'x2', amount: 280, date: new Date(2026, 6, 21, 19, 0) },
    ]
    const lines = claimableLines({ trips: legacy })
    expect(lines.map((l) => l.id)).toEqual(['commute-2026-07-21'])
    expect(lines[0].amount).toBe(560)
  })
})

describe('reportLines', () => {
  it('gathers only the lines on one report', () => {
    const lines = reportLines('r1', {
      items: [
        { id: 'b', item: 'Taxi', amount: 3000, claimId: 'r1', date: new Date('2026-07-19') },
        { id: 'a', item: 'Paper', amount: 1200, date: new Date('2026-07-20') },
      ],
      trips: [{ id: 't3', dateKey: '2026-07-18', amount: 280, date: new Date('2026-07-18'), claimId: 'r1' }],
    })
    expect(lines.map((l) => l.id)).toEqual(['b', 'commute-2026-07-18'])
    expect(sumLines(lines)).toBe(3280)
  })
})

describe('reimbursementSummary', () => {
  const claims = [
    { id: 'd', status: 'draft', claimedAmount: 1000 },
    { id: 's', status: 'submitted', claimedAmount: 2000 },
    { id: 'a', status: 'approved', claimedAmount: 3000, approvedAmount: 3500 },
    { id: 'p', status: 'paid', claimedAmount: 4000, approvedAmount: 4200 },
  ]

  it('splits the money by how far along it is', () => {
    const s = reimbursementSummary({ claims })
    expect(s.draft).toBe(1000)
    expect(s.submitted).toBe(2000)
    expect(s.approved).toBe(3500) // what they agreed to, not what it cost
    expect(s.received).toBe(4200)
    expect(s.surplus).toBe(200) // paid 4200 for 4000 of spending
  })

  it('counts unfiled spending and everything still owed', () => {
    const s = reimbursementSummary({
      claims,
      items: [{ id: 'x', amount: 5000, purpose: 'Monitor', date: new Date() }],
    })
    expect(s.toClaim).toBe(5000)
    expect(s.toClaimCount).toBe(1)
    expect(s.issueCount).toBe(1) // ¥5,000 with no receipt
    expect(s.outstanding).toBe(5000 + 1000 + 2000 + 3500)
  })

  it('is all zeros with nothing logged', () => {
    const s = reimbursementSummary({})
    expect(s.outstanding).toBe(0)
    expect(s.received).toBe(0)
  })
})

describe('claiming more than something cost', () => {
  const item = (over) => ({ id: 'a', item: 'Monitor', amount: 1200, date: new Date('2026-07-20'), ...over })

  it('defaults to claiming exactly what it cost', () => {
    const [line] = claimableLines({ items: [item()] })
    expect(line.amount).toBe(1200)
    expect(line.claimAmount).toBe(1200)
    expect(lineMarkup(line)).toBe(0)
  })

  it('tracks the markup when you ask for more', () => {
    const [line] = claimableLines({ items: [item({ claimAmount: 1500 })] })
    expect(line.amount).toBe(1200) // what it really cost
    expect(line.claimAmount).toBe(1500) // what you asked for
    expect(lineMarkup(line)).toBe(300) // profit if approved
  })

  it('separates report cost from report request', () => {
    const items = [item({ claimAmount: 1500, claimId: 'r1' }), item({ id: 'b', amount: 800, claimId: 'r1' })]
    const lines = reportLines('r1', { items })
    expect(sumLines(lines)).toBe(2000) // out of pocket
    expect(sumRequested(lines)).toBe(2300) // asked the office for
  })

  it('follows an edit made after the report was already submitted', () => {
    const before = [item({ claimId: 'r1' })]
    expect(sumRequested(reportLines('r1', { items: before }))).toBe(1200)
    // You remember you actually claimed ¥1,500 and fix the line.
    const after = [item({ claimAmount: 1500, claimId: 'r1' })]
    expect(sumRequested(reportLines('r1', { items: after }))).toBe(1500)
    expect(sumLines(reportLines('r1', { items: after }))).toBe(1200) // cost unchanged
  })
})
