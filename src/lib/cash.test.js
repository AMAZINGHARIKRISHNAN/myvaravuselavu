import { describe, it, expect } from 'vitest'
import { countTotal, pieceCount, latestCounts, cashPosition, recountDrift, denomRows, cashLedger } from './cash'
import { parseDateInput } from './format'

describe('countTotal / pieceCount', () => {
  it('multiplies each denomination by its quantity', () => {
    expect(countTotal({ 10000: 3, 1000: 2, 500: 1, 100: 4 })).toBe(32900)
    expect(pieceCount({ 10000: 3, 1000: 2, 500: 1, 100: 4 })).toBe(10)
  })

  it('ignores blanks and junk', () => {
    expect(countTotal({ 1000: '', 500: null, abc: 5, 100: '3' })).toBe(300)
    expect(countTotal({})).toBe(0)
  })
})

describe('latestCounts', () => {
  it('keeps only the newest count per stash, of the right country', () => {
    const counts = [
      { id: 'a', stash: 'Wallet', denoms: { 1000: 1 }, date: new Date('2026-07-01') },
      { id: 'b', stash: 'Wallet', denoms: { 1000: 5 }, date: new Date('2026-07-20') },
      { id: 'c', stash: 'Locker', denoms: { 10000: 3 }, date: new Date('2026-07-10') },
      { id: 'd', stash: 'Wallet', denoms: { 500: 2 }, country: 'IN', date: new Date('2026-07-22') },
    ]
    expect(latestCounts(counts, 'JP').map((c) => c.id)).toEqual(['b', 'c']) // newest first
    expect(latestCounts(counts, 'IN').map((c) => c.id)).toEqual(['d'])
  })
})

describe('cashPosition', () => {
  const counts = [
    { id: 'w', stash: 'Wallet', denoms: { 10000: 1, 1000: 2 }, date: new Date('2026-07-20') },
    { id: 'l', stash: 'Locker', denoms: { 10000: 5 }, date: new Date('2026-07-05') },
  ]

  it('adds up the newest count of every stash', () => {
    const p = cashPosition({ counts })
    expect(p.counted).toBe(12000 + 50000)
    expect(p.expected).toBe(62000)
    expect(p.stashes.map((s) => s.stash)).toEqual(['Wallet', 'Locker'])
    expect(p.stashes[0].pieces).toBe(3)
  })

  it('only moves the total with cash dated after the newest count', () => {
    const p = cashPosition({
      counts,
      expenses: [
        // Before the last count — already in hand when counted, must not deduct.
        { amount: 3000, paymentMethod: 'Cash', date: new Date('2026-07-10') },
        { amount: 800, paymentMethod: 'Cash', date: new Date('2026-07-22') },
        { amount: 999, paymentMethod: 'Rakuten Debit', date: new Date('2026-07-22') },
      ],
      income: [{ amount: 5000, account: 'Cash', date: new Date('2026-07-23') }],
      recharges: [{ amount: 2000, paidFrom: 'Cash', date: new Date('2026-07-23') }],
    })
    expect(p.counted).toBe(62000)
    expect(p.spent).toBe(800)
    expect(p.received).toBe(5000)
    expect(p.loaded).toBe(2000)
    expect(p.expected).toBe(62000 + 5000 - 800 - 2000)
  })

  it('keeps rupee cash out of the yen total', () => {
    const p = cashPosition({
      counts,
      expenses: [{ amount: 500, paymentMethod: 'Cash', country: 'IN', date: new Date('2026-07-22') }],
    })
    expect(p.spent).toBe(0)
    expect(p.expected).toBe(62000)
  })

  it('reports no count yet on an empty ledger', () => {
    const p = cashPosition({})
    expect(p.hasCount).toBe(false)
    expect(p.counted).toBe(0)
    expect(p.countedAt).toBe(null)
  })
})

describe('recountDrift', () => {
  const position = cashPosition({
    counts: [{ stash: 'Wallet', denoms: { 1000: 5 }, date: new Date('2026-07-20') }],
  })

  it('compares a fresh count against that stash’s last one', () => {
    expect(recountDrift({ stash: 'Wallet', denoms: { 1000: 3 }, position })).toBe(-2000)
    expect(recountDrift({ stash: 'wallet', denoms: { 1000: 5 }, position })).toBe(0)
  })

  it('has nothing to compare for a stash counted for the first time', () => {
    expect(recountDrift({ stash: 'Locker', denoms: { 10000: 1 }, position })).toBe(null)
  })
})

describe('denomRows', () => {
  it('lists only what is held, biggest first, with subtotals', () => {
    expect(denomRows({ 10000: 2, 1000: 0, 100: 3 })).toEqual([
      { value: 10000, qty: 2, subtotal: 20000 },
      { value: 100, qty: 3, subtotal: 300 },
    ])
  })

  it('uses rupee denominations for IN', () => {
    expect(denomRows({ 500: 2, 20: 1 }, 'IN').map((r) => r.value)).toEqual([500, 20])
  })
})

describe('cash vs. money fronted for the office', () => {
  const counts = [{ stash: 'Wallet', denoms: { 10000: 1 }, date: new Date('2026-07-20') }]

  it('takes cash-paid office purchases out of the wallet', () => {
    const p = cashPosition({
      counts,
      officeItems: [
        { amount: 3000, paidWith: 'Cash', date: new Date('2026-07-22') },
        { amount: 500, paidWith: 'Rakuten Debit', date: new Date('2026-07-22') }, // other source
      ],
    })
    expect(p.fronted).toBe(3000)
    expect(p.expected).toBe(7000) // the notes really did leave your pocket
  })

  it('ignores office items logged before the field existed', () => {
    const p = cashPosition({
      counts,
      officeItems: [{ amount: 3000, date: new Date('2026-07-22') }], // legacy, no paidWith
    })
    expect(p.fronted).toBe(0)
    expect(p.expected).toBe(10000)
  })

  it('nets out to zero once the office pays it back', () => {
    const officeItems = [{ amount: 3000, paidWith: 'Cash', date: new Date('2026-07-21') }]
    const income = [{ amount: 3000, account: 'Cash', date: new Date('2026-07-28') }]
    // Out of pocket, then repaid into cash: back where you started.
    expect(cashPosition({ counts, officeItems, income }).expected).toBe(10000)
  })
})

describe('hand-logged ➕/➖ on cash', () => {
  const counts = [{ id: 'c1', stash: 'Wallet', denoms: { 10000: 1 }, country: 'JP', date: new Date('2026-07-20') }]

  it('adds a credit and subtracts a debit dated after the count', () => {
    const p = cashPosition({
      counts,
      accountEntries: [
        { id: 'a1', account: 'Cash', direction: 'credit', amount: 3000, country: 'JP', date: new Date('2026-07-25') },
        { id: 'a2', account: 'Cash', direction: 'debit', amount: 500, country: 'JP', date: new Date('2026-07-26') },
      ],
      country: 'JP',
    })
    expect(p.adjusted).toBe(2500)
    expect(p.expected).toBe(12500)
  })

  it('keeps rupee entries out of the yen total — and lets rupee cash be corrected', () => {
    const entries = [
      { id: 'a1', account: 'Cash', direction: 'credit', amount: 2000, country: 'IN', date: new Date('2026-07-25') },
    ]
    expect(cashPosition({ counts, accountEntries: entries, country: 'JP' }).adjusted).toBe(0)
    expect(cashPosition({ counts: [], accountEntries: entries, country: 'IN' }).expected).toBe(2000)
  })

  it('ignores entries on an account rather than cash', () => {
    const entries = [
      { id: 'a1', account: 'MUFJ', direction: 'credit', amount: 9999, country: 'JP', date: new Date('2026-07-25') },
    ]
    expect(cashPosition({ counts, accountEntries: entries, country: 'JP' }).adjusted).toBe(0)
  })
})

describe('bank withdrawals into cash', () => {
  const counts = [{ stash: 'Wallet', denoms: { 1000: 5 }, date: new Date('2026-07-20') }]

  it('adds a withdrawal dated after the count to cash on hand', () => {
    const p = cashPosition({
      counts,
      withdrawals: [{ account: 'MUFJ', amount: 10000, country: 'JP', date: new Date('2026-07-25') }],
    })
    expect(p.withdrawn).toBe(10000)
    expect(p.expected).toBe(15000) // 5,000 counted + 10,000 pulled out
  })

  it('ignores a withdrawal dated before the last count (already in hand)', () => {
    const p = cashPosition({
      counts,
      withdrawals: [{ account: 'MUFJ', amount: 10000, country: 'JP', date: new Date('2026-07-10') }],
    })
    expect(p.withdrawn).toBe(0)
    expect(p.expected).toBe(5000)
  })

  it('keeps a rupee withdrawal out of the yen cash total', () => {
    const p = cashPosition({
      counts,
      withdrawals: [{ account: 'ICICI', amount: 3000, country: 'IN', date: new Date('2026-07-25') }],
      country: 'JP',
    })
    expect(p.withdrawn).toBe(0)
  })
})

describe('cashLedger', () => {
  const counts = [{ stash: 'Wallet', denoms: { 10000: 2 }, date: new Date('2026-07-20') }]
  const data = {
    counts,
    expenses: [
      { id: 'e1', amount: 800, paymentMethod: 'Cash', store: 'Lawson', category: 'Food', date: new Date('2026-07-22') },
      { id: 'e0', amount: 500, paymentMethod: 'Cash', category: 'Food', date: new Date('2026-07-10') }, // before count
      { id: 'e2', amount: 999, paymentMethod: 'Rakuten', date: new Date('2026-07-22') }, // not cash
    ],
    income: [{ id: 'i1', amount: 5000, account: 'Cash', source: 'Gift', date: new Date('2026-07-23') }],
    withdrawals: [{ id: 'w1', account: 'MUFJ', amount: 10000, country: 'JP', date: new Date('2026-07-24') }],
  }

  it('lists cash movements since the last count, newest first, with the shop', () => {
    const rows = cashLedger(data)
    expect(rows.map((r) => r.id)).toEqual(['w-w1', 'i-i1', 'e-e1']) // e0 (pre-count) & non-cash excluded
    expect(rows.find((r) => r.id === 'e-e1').place).toBe('Lawson')
    expect(rows.find((r) => r.id === 'e-e1').amount).toBe(-800)
  })

  it('sums to exactly (expected − counted), so it always explains the drift', () => {
    const pos = cashPosition(data)
    const ledgerNet = cashLedger(data).reduce((s, r) => s + r.amount, 0)
    expect(ledgerNet).toBe(pos.expected - pos.counted)
  })
})

// Same cutoff bug as cardBalance: a count and an expense both backdated to one
// day share a timestamp, and the expense used to vanish — reporting more cash
// on hand than was actually in the wallet.
describe('cashPosition: a count does not swallow records dated the same day', () => {
  const noon = (iso) => parseDateInput(iso)

  it('counts a cash expense backdated to the count day', () => {
    const pos = cashPosition({
      counts: [{ id: 'c', stash: 'Wallet', denoms: { 1000: 5 }, date: noon('2026-01-10') }],
      expenses: [{ id: 'e', paymentMethod: 'Cash', amount: 1000, country: 'JP', date: noon('2026-01-10') }],
    })
    expect(pos.expected).toBe(4000)
  })

  it('still ignores spending dated before the count day', () => {
    const pos = cashPosition({
      counts: [{ id: 'c', stash: 'Wallet', denoms: { 1000: 5 }, date: noon('2026-01-10') }],
      expenses: [{ id: 'e', paymentMethod: 'Cash', amount: 1000, country: 'JP', date: noon('2026-01-09') }],
    })
    expect(pos.expected).toBe(5000)
  })

  it('a count taken this evening still ignores this morning’s spending', () => {
    const pos = cashPosition({
      counts: [{ id: 'c', stash: 'Wallet', denoms: { 1000: 5 }, date: new Date(2026, 0, 10, 20, 0) }],
      expenses: [
        { id: 'e', paymentMethod: 'Cash', amount: 1000, country: 'JP', date: new Date(2026, 0, 10, 10, 30) },
      ],
    })
    expect(pos.expected).toBe(5000)
  })

  it('the ledger still explains the drift exactly after the cutoff change', () => {
    const data = {
      counts: [{ id: 'c', stash: 'Wallet', denoms: { 1000: 5 }, date: noon('2026-01-10') }],
      expenses: [{ id: 'e', paymentMethod: 'Cash', amount: 1000, country: 'JP', date: noon('2026-01-10') }],
      withdrawals: [{ id: 'w', account: 'MUFJ', amount: 2000, country: 'JP', date: noon('2026-01-10') }],
    }
    const pos = cashPosition(data)
    const net = cashLedger(data).reduce((s, r) => s + r.amount, 0)
    expect(net).toBe(pos.expected - pos.counted)
  })
})
