import { describe, it, expect } from 'vitest'
import { buildActivityFeed } from './activity'

describe('buildActivityFeed', () => {
  const data = {
    expenses: [{ id: 'e1', amount: 500, category: 'Food', paymentMethod: 'Cash', date: new Date('2026-07-10') }],
    income: [{ id: 'i1', amount: 200000, source: 'Salary', date: new Date('2026-07-25') }],
    transfers: [{ id: 't1', amountSent: 50000, fee: 500, recipient: 'Parents', date: new Date('2026-07-20') }],
    recharges: [{ id: 'r1', amount: 3000, card: 'Pasmo', paidFrom: 'MUFJ', date: new Date('2026-07-05') }],
    withdrawals: [{ id: 'w1', account: 'MUFJ', amount: 10000, date: new Date('2026-07-22') }],
    officeItems: [{ id: 'o1', item: 'Taxi', amount: 1500, date: new Date('2026-07-18') }],
    passes: [{ id: 'p1', label: 'July pass', cost: 17000, startDate: new Date('2026-07-01'), date: new Date('2026-07-01') }],
    friendPurchases: [{ id: 'f1', item: 'Lunch', friend: 'Ravi', cost: 1200, date: new Date('2026-07-12') }],
    orders: [{ id: 'ord1', item: 'Shirt', store: 'Temu', cashPaid: 2000, date: new Date('2026-07-08') }],
    windfalls: [{ id: 'wf1', label: 'Pasmo refund', received: 56000, cost: 0, date: new Date('2026-07-27') }],
    cashCounts: [{ id: 'c1', stash: 'Wallet', total: 15000, date: new Date('2026-07-26') }],
  }

  it('merges every collection into one feed, newest first', () => {
    const feed = buildActivityFeed(data)
    expect(feed).toHaveLength(11) // one row per record above
    expect(feed[0].id).toBe('wf1'.replace('wf1', 'wf-wf1')) // 7/27 windfall is newest
    expect(feed.map((r) => r.date.getTime())).toEqual(
      [...feed.map((r) => r.date.getTime())].sort((a, b) => b - a)
    )
  })

  it('labels the money direction: out / in / move', () => {
    const byId = Object.fromEntries(buildActivityFeed(data).map((r) => [r.id, r]))
    expect(byId['e-e1'].tone).toBe('out') // expense
    expect(byId['i-i1'].tone).toBe('in') // income
    expect(byId['t-t1'].tone).toBe('out') // transfer out
    // The fee is taken out of the amount sent, never charged on top of it.
    expect(byId['t-t1'].amount).toBe(50000)
    expect(byId['r-r1'].tone).toBe('move') // bank → card
    expect(byId['w-w1'].tone).toBe('move') // bank → cash
    expect(byId['wf-wf1'].tone).toBe('in') // windfall gain
    expect(byId['c-c1'].tone).toBe('move') // cash count
  })

  it('treats a company card credit as money in, a normal top-up as a move', () => {
    const feed = buildActivityFeed({
      recharges: [
        { id: 'edenred', amount: 10000, card: 'Edenred', paidFrom: null, date: new Date('2026-07-16') },
        { id: 'self', amount: 3000, card: 'Pasmo', paidFrom: 'MUFJ', date: new Date('2026-07-17') },
      ],
    })
    expect(feed.find((r) => r.id === 'r-edenred').tone).toBe('in')
    expect(feed.find((r) => r.id === 'r-self').tone).toBe('move')
  })

  it('shows a shopping return as money in, an order as money out', () => {
    const feed = buildActivityFeed({
      orders: [
        { id: 'a', item: 'A', cashPaid: 2000, date: new Date('2026-07-01') },
        { id: 'b', item: 'B', status: 'returned', refundMoney: 2500, date: new Date('2026-07-02') },
      ],
    })
    expect(feed.find((r) => r.id === 'ord-a').tone).toBe('out')
    expect(feed.find((r) => r.id === 'ord-b').tone).toBe('in')
    expect(feed.find((r) => r.id === 'ord-b').amount).toBe(2500)
  })

  it('shows a hand-logged credit as money in and a debit as money out', () => {
    const feed = buildActivityFeed({
      accountEntries: [
        { id: 'a1', account: 'ICICI', direction: 'credit', amount: 1200, reason: 'Interest', country: 'IN', date: new Date('2026-07-20') },
        { id: 'a2', account: 'MUFJ', direction: 'debit', amount: 300, country: 'JP', date: new Date('2026-07-21') },
      ],
    })
    const credit = feed.find((r) => r.id === 'ae-a1')
    expect(credit.tone).toBe('in')
    expect(credit.title).toBe('Interest')
    expect(credit.detail).toBe('into ICICI')
    expect(credit.country).toBe('IN')
    const debit = feed.find((r) => r.id === 'ae-a2')
    expect(debit.tone).toBe('out')
    expect(debit.title).toBe('Money out')
  })

  it('drops records with no date and is empty on no input', () => {
    expect(buildActivityFeed({ expenses: [{ id: 'x', amount: 1 }] })).toHaveLength(0)
    expect(buildActivityFeed()).toEqual([])
  })
})
