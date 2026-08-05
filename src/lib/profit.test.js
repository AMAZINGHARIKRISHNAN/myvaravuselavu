import { describe, it, expect } from 'vitest'
import { reimbursementProfit, shoppingRefundProfit, buildProfitSources, profitEvents } from './profit'

const claim = (over) => ({ status: 'paid', claimedAmount: 5600, ...over })

describe('reimbursementProfit', () => {
  it('counts the surplus on paid claims', () => {
    const out = reimbursementProfit([claim({ approvedAmount: 6000 })])
    expect(out.realized).toBe(400)
    expect(out.realizedCount).toBe(1)
    expect(out.pending).toBe(0)
  })

  it('keeps approved-but-unpaid money out of the realized total', () => {
    const out = reimbursementProfit([claim({ status: 'approved', approvedAmount: 6000 })])
    expect(out.realized).toBe(0)
    expect(out.pending).toBe(400)
    expect(out.pendingCount).toBe(1)
  })

  it('reports a shortfall as negative', () => {
    expect(reimbursementProfit([claim({ approvedAmount: 5000 })]).realized).toBe(-600)
  })

  it('ignores submitted claims — no approved figure exists yet', () => {
    const out = reimbursementProfit([claim({ status: 'submitted', approvedAmount: null })])
    expect(out.realized).toBe(0)
    expect(out.pending).toBe(0)
  })

  it('treats legacy approved+paid claims as break-even, not profit', () => {
    // Old flow: status 'approved' with an incomeId meant the money arrived and
    // always equalled the spend, so there is nothing to count.
    const out = reimbursementProfit([
      { status: 'approved', incomeId: 'inc1', claimedAmount: 5600, approvedAmount: null },
    ])
    expect(out.realized).toBe(0)
  })

  it('ignores claims created before spend was snapshotted', () => {
    expect(reimbursementProfit([{ status: 'paid' }]).realized).toBe(0)
  })
})

describe('shoppingRefundProfit', () => {
  it('counts refunds bigger than what was paid', () => {
    const out = shoppingRefundProfit([
      { status: 'returned', cashPaid: 1000, refundMoney: 1200, refundStatus: 'received' },
    ])
    expect(out.realized).toBe(200)
  })

  it('holds pending refunds separately', () => {
    const out = shoppingRefundProfit([
      { status: 'returned', cashPaid: 1000, refundMoney: 1200, refundStatus: 'pending' },
    ])
    expect(out.realized).toBe(0)
    expect(out.pending).toBe(200)
  })

  it('ignores ordinary returns and non-returned orders', () => {
    const out = shoppingRefundProfit([
      { status: 'returned', cashPaid: 1000, refundMoney: 1000, refundStatus: 'received' },
      { status: 'delivered', cashPaid: 1000, refundMoney: 5000 },
    ])
    expect(out.realized).toBe(0)
  })
})

describe('buildProfitSources', () => {
  it('returns nothing when there is no profit anywhere', () => {
    expect(buildProfitSources({}).sources).toEqual([])
  })

  it('adds yen sources into one total', () => {
    const { sources, total } = buildProfitSources({
      friendPurchases: [{ country: 'JP', cost: 500, paid: 500, due: 600, received: 600 }],
      claims: [claim({ approvedAmount: 6000 })],
    })
    expect(sources.map((s) => s.key)).toEqual(['friends', 'reimbursements'])
    expect(total).toBe(500) // 100 friend profit + 400 reimbursement surplus
  })

  it('reports rupee deals separately and never in the yen total', () => {
    const { sources, total } = buildProfitSources({
      friendPurchases: [{ country: 'IN', cost: 100, paid: 100, due: 150, received: 150 }],
    })
    expect(total).toBe(0)
    expect(sources[0].key).toBe('friends-in')
    expect(sources[0].excludeFromTotal).toBe(true)
  })

  it('surfaces approved-but-unpaid money as a pending total', () => {
    const { total, pendingTotal } = buildProfitSources({
      claims: [claim({ status: 'approved', approvedAmount: 6000 })],
    })
    expect(total).toBe(0)
    expect(pendingTotal).toBe(400)
  })
})

describe('date-scoped profit', () => {
  const july = { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31, 23, 59, 59) }

  it('counts a claim in the month its money arrived, not when it was filed', () => {
    const c = claim({ approvedAmount: 6000, date: new Date(2026, 5, 20), paidAt: new Date(2026, 6, 10) })
    expect(reimbursementProfit([c], july).realized).toBe(400)
    expect(reimbursementProfit([c], { start: new Date(2026, 5, 1), end: new Date(2026, 5, 30) }).realized).toBe(0)
  })

  it('filters refunds and friend deals by their own dates', () => {
    const { total } = buildProfitSources({
      friendPurchases: [
        { country: 'JP', cost: 500, paid: 500, due: 600, received: 600, date: new Date(2026, 6, 3) },
        { country: 'JP', cost: 500, paid: 500, due: 900, received: 900, date: new Date(2026, 3, 3) },
      ],
      orders: [
        { status: 'returned', cashPaid: 1000, refundMoney: 1200, refundStatus: 'received', date: new Date(2026, 6, 5) },
      ],
      range: july,
    })
    expect(total).toBe(300) // 100 friend (July only) + 200 refund
  })

  it('drops records with no usable date once a range is given', () => {
    expect(buildProfitSources({ claims: [claim({ approvedAmount: 6000, date: null })], range: july }).total).toBe(0)
  })
})

describe('keep-the-product refunds', () => {
  it('counts the whole refund as profit when you keep the goods', () => {
    // Temu/Shein: "keep it, we'll refund you anyway" — money back AND the item.
    const out = shoppingRefundProfit([
      { status: 'returned', cashPaid: 3000, refundMoney: 3000, keptItem: true, date: new Date('2026-07-10') },
    ])
    expect(out.realized).toBe(3000)
  })

  it('still nets against what you paid for a normal return', () => {
    const out = shoppingRefundProfit([
      { status: 'returned', cashPaid: 3000, refundMoney: 3000, date: new Date('2026-07-10') },
    ])
    expect(out.realized).toBe(0) // money back, goods gone — a wash
  })
})

describe('profitEvents', () => {
  const base = {
    friendPurchases: [
      { id: 'f1', item: 'Concert ticket', friend: 'Ravi', cost: 5000, paid: 5000, due: 5500, received: 5500, date: new Date('2026-07-05') },
      { id: 'f2', item: 'Unpaid', friend: 'Sam', cost: 1000, paid: 1000, due: 1500, received: 0, date: new Date('2026-07-06') },
    ],
    claims: [
      { id: 'c1', name: 'July claim', status: 'paid', claimedAmount: 4000, approvedAmount: 4400, paidAt: new Date('2026-07-25') },
      { id: 'c2', name: 'Aug claim', status: 'approved', claimedAmount: 2000, approvedAmount: 2300, approvedAt: new Date('2026-07-28') },
    ],
    orders: [
      { id: 'o1', item: 'Jacket', store: 'Temu', status: 'returned', cashPaid: 3000, refundMoney: 3000, keptItem: true, date: new Date('2026-07-10') },
    ],
    windfalls: [
      { id: 'w1', label: 'Pasmo cancelled', kind: 'cardRefund', received: 56000, cost: 0, date: new Date('2026-07-20') },
    ],
  }

  it('lists one row per real gain, newest first', () => {
    const events = profitEvents(base)
    expect(events.map((e) => e.id)).toEqual([
      'claim-c2', // 7/28 approved, not yet paid
      'claim-c1', // 7/25
      'windfall-w1', // 7/20
      'order-o1', // 7/10
      'friend-f1', // 7/5
    ])
    expect(events.find((e) => e.id === 'friend-f1').amount).toBe(500)
    expect(events.find((e) => e.id === 'order-o1').amount).toBe(3000) // kept the goods
    expect(events.find((e) => e.id === 'windfall-w1').amount).toBe(56000)
  })

  it('leaves out an unsettled friend debt — it is not profit yet', () => {
    expect(profitEvents(base).some((e) => e.id === 'friend-f2')).toBe(false)
  })

  it('flags money that has not actually arrived', () => {
    const events = profitEvents(base)
    expect(events.find((e) => e.id === 'claim-c2').pending).toBe(true)
    expect(events.find((e) => e.id === 'claim-c1').pending).toBe(false)
  })

  it('respects a date range', () => {
    const july20on = { start: new Date('2026-07-20'), end: new Date('2026-07-31') }
    const ids = profitEvents({ ...base, range: july20on }).map((e) => e.id)
    expect(ids).toEqual(['claim-c2', 'claim-c1', 'windfall-w1'])
  })

  it('adds up to the same money as the source rollup', () => {
    const events = profitEvents(base).filter((e) => !e.pending && e.country !== 'IN')
    const { total } = buildProfitSources(base)
    expect(events.reduce((s, e) => s + e.amount, 0)).toBe(total)
  })
})
