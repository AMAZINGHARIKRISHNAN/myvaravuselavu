import { describe, it, expect } from 'vitest'
import { accountBalance } from './balances'
import { cashPosition } from './cash'
import { cardBalance, buildHistory, PREPAID_CARDS, edenredCreditOp } from './wallet'
import { buildActivityFeed } from './activity'
import { moveOps, moneyPlaces, findPlace } from './moveMoney'

// ---------------------------------------------------------------------------
// A TALLY audit: does everything the History page shows add up to everything
// the balances say?
//
// The ledger audit checked that each balance is explained by its own history.
// This is stronger — a CONSERVATION law over the whole app:
//
//   Total money you hold changes ONLY by money entering or leaving your world.
//   Moving it between your own places must change the total by exactly zero.
//
// That single rule catches an entire family of bugs at once: a movement
// counted on one side but not the other, a movement counted twice, a movement
// recorded in a collection nothing reads. None of those can survive it.
// ---------------------------------------------------------------------------

const d = (day) => new Date(2026, 7, day, 12)
const money = (n) => Math.round(n * 100) / 100
const ANCHOR = new Date(2026, 6, 1)

const ACCOUNTS = [
  { label: 'MUFJ', country: 'JP', openingBalance: 400000, openingBalanceAt: ANCHOR },
  { label: 'Rakuten', country: 'JP', openingBalance: 50000, openingBalanceAt: ANCHOR },
  { label: 'ICICI', country: 'IN', openingBalance: 20000, openingBalanceAt: ANCHOR },
]

const EMPTY = {
  expenses: [],
  income: [],
  transfers: [],
  recharges: [],
  officeItems: [],
  passes: [],
  withdrawals: [],
  accountEntries: [],
  cashCounts: [],
}

// Everything you hold, in yen. Bank accounts + cash in hand + every prepaid
// card. Rupee accounts are counted separately — they are other money.
function totalYen(data, accounts = ACCOUNTS) {
  const banks = accounts
    .filter((a) => a.country !== 'IN')
    .reduce((s, a) => s + accountBalance(a, data, accounts), 0)
  const cash = cashPosition({ counts: data.cashCounts, ...data, country: 'JP' }).expected
  const cards = PREPAID_CARDS.reduce(
    (s, c) => s + cardBalance(c.name, data.recharges, data.expenses, data.officeItems, data.passes),
    0
  )
  return money(banks + cash + cards)
}

const totalInr = (data, accounts = ACCOUNTS) =>
  money(
    accounts
      .filter((a) => a.country === 'IN')
      .reduce((s, a) => s + accountBalance(a, data, accounts), 0)
  )

describe('TALLY 1 · moving your own money changes the total by nothing', () => {
  const places = moneyPlaces(ACCOUNTS)
  const P = (k) => findPlace(places, k)
  const withCash = { ...EMPTY, cashCounts: [{ id: 'c', stash: 'Wallet', denoms: { 10000: 5 }, country: 'JP', date: d(1) }] }
  const before = totalYen(withCash)

  const apply = (ops) => {
    const next = { ...withCash }
    for (const [i, op] of ops.entries()) {
      const key = op.name === 'pasmoRecharges' ? 'recharges' : op.name
      next[key] = [...(next[key] || []), { id: `op${i}`, ...op.data }]
    }
    return next
  }

  it('bank → bank', () => {
    const after = apply(moveOps({ from: P('account:MUFJ'), to: P('account:Rakuten'), amount: 50000, date: d(5) }))
    expect(totalYen(after)).toBe(before)
  })

  it('bank → cash (a withdrawal)', () => {
    const after = apply(moveOps({ from: P('account:MUFJ'), to: P('cash:JP'), amount: 30000, date: d(5) }))
    expect(totalYen(after)).toBe(before)
  })

  it('cash → bank (a deposit)', () => {
    const after = apply(moveOps({ from: P('cash:JP'), to: P('account:MUFJ'), amount: 20000, date: d(5) }))
    expect(totalYen(after)).toBe(before)
  })

  it('bank → prepaid card (a top-up)', () => {
    const after = apply(moveOps({ from: P('account:MUFJ'), to: P('card:Pasmo'), amount: 5000, date: d(5) }))
    expect(totalYen(after)).toBe(before)
  })

  it('cash → prepaid card', () => {
    const after = apply(moveOps({ from: P('cash:JP'), to: P('card:nimoca'), amount: 3000, date: d(5) }))
    expect(totalYen(after)).toBe(before)
  })

  it('a chain of moves round every place still nets to zero', () => {
    let data = withCash
    const hops = [
      ['account:MUFJ', 'account:Rakuten', 40000],
      ['account:Rakuten', 'cash:JP', 15000],
      ['cash:JP', 'card:Pasmo', 4000],
      ['cash:JP', 'account:MUFJ', 8000],
    ]
    for (const [from, to, amount] of hops) {
      data = (() => {
        const ops = moveOps({ from: P(from), to: P(to), amount, date: d(6) })
        const next = { ...data }
        for (const [i, op] of ops.entries()) {
          const key = op.name === 'pasmoRecharges' ? 'recharges' : op.name
          next[key] = [...(next[key] || []), { id: `${from}-${to}-${i}`, ...op.data }]
        }
        return next
      })()
    }
    expect(totalYen(data)).toBe(before)
  })

  it('a bank fee is the ONLY thing a move may cost you', () => {
    const after = apply(
      moveOps({ from: P('account:MUFJ'), to: P('account:Rakuten'), amount: 50000, fee: 330, date: d(5) })
    )
    expect(totalYen(after)).toBe(money(before - 330))
  })
})

describe('TALLY 2 · money entering and leaving moves the total by exactly that', () => {
  const base = { ...EMPTY, cashCounts: [{ id: 'c', stash: 'Wallet', denoms: { 10000: 5 }, country: 'JP', date: d(1) }] }
  const before = totalYen(base)

  it('salary in', () => {
    const data = { ...base, income: [{ id: 'i', amount: 511633, account: 'MUFJ', country: 'JP', date: d(25) }] }
    expect(totalYen(data)).toBe(money(before + 511633))
  })

  it('spending out, whichever place it came from', () => {
    for (const [method, extra] of [
      ['MUFJ', {}],
      ['Cash', {}],
      ['Pasmo', { recharges: [{ id: 'r', card: 'Pasmo', amount: 5000, date: d(2) }] }],
    ]) {
      const start = totalYen({ ...base, ...extra })
      const data = {
        ...base,
        ...extra,
        expenses: [{ id: 'e', amount: 1200, paymentMethod: method, country: 'JP', date: d(5) }],
      }
      expect(totalYen(data)).toBe(money(start - 1200))
    }
  })

  it('a remittance leaves the yen world and arrives in the rupee one', () => {
    const data = {
      ...base,
      transfers: [
        { id: 't', amountSent: 100000, amountReceived: 55000, fee: 800, fromAccount: 'MUFJ', toAccount: 'ICICI', date: d(20) },
      ],
    }
    expect(totalYen(data)).toBe(money(before - 100000))
    expect(totalInr(data)).toBe(money(20000 + 55000))
  })

  it('money sent to family leaves and arrives nowhere of yours', () => {
    const data = {
      ...base,
      transfers: [{ id: 't', amountSent: 40000, amountReceived: 22000, fromAccount: 'MUFJ', toAccount: null, date: d(21) }],
    }
    expect(totalYen(data)).toBe(money(before - 40000))
    expect(totalInr(data)).toBe(20000)
  })

  it('the company Edenred credit is money arriving from outside', () => {
    const op = edenredCreditOp('2026-08')
    const data = { ...base, recharges: [{ id: 'ed', ...op.data }] }
    expect(totalYen(data)).toBe(money(before + 10000))
  })

  it('money fronted for the office leaves now and returns as income later', () => {
    const out = { ...base, officeItems: [{ id: 'o', amount: 3000, paidWith: 'MUFJ', country: 'JP', date: d(9) }] }
    expect(totalYen(out)).toBe(money(before - 3000))
    const repaid = { ...out, income: [{ id: 'i', amount: 3000, account: 'MUFJ', country: 'JP', date: d(28) }] }
    expect(totalYen(repaid)).toBe(before)
  })
})

describe('TALLY 3 · every record that moves a balance is in the History feed', () => {
  const op = edenredCreditOp('2026-08')
  const data = {
    expenses: [{ id: 'e', amount: 1200, paymentMethod: 'MUFJ', country: 'JP', date: d(5) }],
    income: [{ id: 'i', amount: 511633, account: 'MUFJ', country: 'JP', date: d(25) }],
    transfers: [{ id: 't', amountSent: 100000, amountReceived: 55000, fromAccount: 'MUFJ', toAccount: 'ICICI', date: d(20) }],
    recharges: [{ id: 'r', card: 'Pasmo', amount: 5000, paidFrom: 'MUFJ', date: d(3) }, { id: 'ed', ...op.data }],
    officeItems: [{ id: 'o', amount: 3000, paidWith: 'MUFJ', date: d(9) }],
    passes: [{ id: 'p', label: 'Aug', cost: 17000, paidFrom: 'MUFJ', date: d(2), startDate: d(2) }],
    withdrawals: [{ id: 'w', account: 'MUFJ', amount: 30000, country: 'JP', date: d(4) }],
    accountEntries: [{ id: 'a', account: 'MUFJ', direction: 'credit', amount: 1200, date: d(12) }],
    cashCounts: [{ id: 'c', stash: 'Wallet', denoms: { 10000: 5 }, country: 'JP', date: d(1) }],
  }

  it('nothing a balance counts is missing from what the user can see', () => {
    const feed = buildActivityFeed(data)
    const written = Object.values(data).reduce((s, list) => s + list.length, 0)
    expect(feed.length).toBe(written)
  })

  it('every collection the balance maths reads is represented', () => {
    const kinds = new Set(buildActivityFeed(data).map((r) => r.kind))
    for (const kind of ['Expense', 'Income', 'Transfer', 'Card top-up', 'Office claim', 'Commuter pass', 'Withdrawal', 'Credited', 'Cash count']) {
      expect(kinds.has(kind)).toBe(true)
    }
  })

  it('a move is folded to one row without losing the other half of the money', () => {
    const places = moneyPlaces(ACCOUNTS)
    const ops = moveOps({
      from: findPlace(places, 'account:MUFJ'),
      to: findPlace(places, 'account:Rakuten'),
      amount: 50000,
      date: d(7),
    })
    const entries = ops.map((o, i) => ({ id: `m${i}`, ...o.data }))
    const feed = buildActivityFeed({ accountEntries: entries })
    expect(feed).toHaveLength(1)
    // One row on screen, but both halves still in the ledger.
    const withMove = { ...EMPTY, accountEntries: entries }
    expect(accountBalance(ACCOUNTS[0], withMove, ACCOUNTS)).toBe(400000 - 50000)
    expect(accountBalance(ACCOUNTS[1], withMove, ACCOUNTS)).toBe(50000 + 50000)
  })
})

describe('TALLY 4 · each place’s own history closes on its balance', () => {
  const data = {
    ...EMPTY,
    expenses: [
      { id: 'e1', amount: 1200, paymentMethod: 'MUFJ', country: 'JP', date: d(5) },
      { id: 'e2', amount: 560, paymentMethod: 'Pasmo', country: 'JP', date: d(6) },
    ],
    income: [{ id: 'i', amount: 511633, account: 'MUFJ', country: 'JP', date: d(25) }],
    recharges: [{ id: 'r', card: 'Pasmo', amount: 5000, paidFrom: 'MUFJ', date: d(3) }],
    withdrawals: [{ id: 'w', account: 'MUFJ', amount: 30000, country: 'JP', date: d(4) }],
    accountEntries: [{ id: 'a', account: 'MUFJ', direction: 'debit', amount: 250, date: d(12) }],
    cashCounts: [{ id: 'c', stash: 'Wallet', denoms: { 10000: 5 }, country: 'JP', date: d(1) }],
  }

  it('a bank account', () => {
    const account = ACCOUNTS[0]
    const rows = buildHistory('MUFJ', { ...data, country: 'JP' })
    const movement = rows.reduce((s, r) => s + r.amount, 0)
    expect(money(movement)).toBe(money(accountBalance(account, data, ACCOUNTS) - account.openingBalance))
  })

  it('a prepaid card', () => {
    const rows = buildHistory('Pasmo', data)
    const movement = rows.reduce((s, r) => s + r.amount, 0)
    expect(money(movement)).toBe(money(cardBalance('Pasmo', data.recharges, data.expenses, data.officeItems, data.passes)))
  })

  it('cash in hand', () => {
    const pos = cashPosition({ counts: data.cashCounts, ...data, country: 'JP' })
    const rows = buildHistory('Cash', { ...data, country: 'JP' })
    const movement = rows.reduce((s, r) => s + r.amount, 0)
    expect(money(movement)).toBe(money(pos.expected - pos.counted))
  })
})
