import { describe, it, expect } from 'vitest'
import { accountBalance, cutoffFor, ignoredBeforeCutoff } from './balances'
import { buildHistory } from './wallet'
import { cashPosition, cashLedger } from './cash'
import { buildActivityFeed } from './activity'
import { moveOps, moneyPlaces, findPlace } from './moveMoney'
import { toDate, startOfDay } from './format'

// ---------------------------------------------------------------------------
// A ledger audit.
//
// Every screen in this app derives money from the same records by its own set
// of rules, and those rules are written out four times: once in the balance
// maths, once in the per-source history, once in the cash position, once in
// the activity feed. Nothing forced them to agree, and a rule that exists in
// one place and not another is a number the user cannot check.
//
// So this asserts the invariants BETWEEN modules, not inside them:
//
//   1. The history of an account sums to exactly the balance it explains.
//   2. Both halves of a paired movement always agree.
//   3. Nothing is counted twice.
//   4. Everything recorded shows up somewhere the user can find it.
// ---------------------------------------------------------------------------

const ACCOUNTS = [
  { label: 'MUFJ', country: 'JP', openingBalance: 471157, openingBalanceAt: new Date(2026, 6, 1) },
  { label: 'ICICI NRO', country: 'IN', openingBalance: 15941.25, openingBalanceAt: new Date(2026, 6, 1) },
  { label: 'ICICI NRE', country: 'IN', openingBalance: 50000, openingBalanceAt: new Date(2026, 6, 1) },
]

// One of every kind of record this app writes, all after the cutoff.
const d = (day) => new Date(2026, 7, day, 12)
const DATA = {
  expenses: [
    { id: 'e1', amount: 5056, paymentMethod: 'ICICI NRO', country: 'IN', date: d(8), category: 'Shopping' },
    { id: 'e2', amount: 18000, paymentMethod: 'ICICI NRO', country: 'IN', date: d(8), category: 'Shopping' },
    { id: 'e3', amount: 2400, paymentMethod: 'MUFJ', country: 'JP', date: d(6), category: 'Food' },
    { id: 'e4', amount: 900, paymentMethod: 'Cash', country: 'JP', date: d(6), category: 'Food' },
  ],
  income: [{ id: 'i1', amount: 511633, account: 'MUFJ', country: 'JP', date: d(5), source: 'Salary' }],
  transfers: [
    { id: 't1', amountSent: 100000, amountReceived: 55000, fee: 800, fromAccount: 'MUFJ', toAccount: 'ICICI NRE', date: d(10) },
    { id: 't2', amountSent: 40000, fromAccount: 'MUFJ', toAccount: null, date: d(11) },
  ],
  accountEntries: [
    { id: 'a1', account: 'ICICI NRE', direction: 'credit', amount: 1200, reason: 'Interest', date: d(12) },
  ],
  recharges: [{ id: 'r1', card: 'Pasmo', amount: 5000, paidFrom: 'MUFJ', date: d(7) }],
  officeItems: [{ id: 'o1', item: 'Taxi', amount: 3000, paidWith: 'MUFJ', date: d(9) }],
  withdrawals: [{ id: 'w1', account: 'MUFJ', amount: 30000, country: 'JP', date: d(4) }],
  passes: [{ id: 'p1', label: 'Aug pass', cost: 17000, paidFrom: 'MUFJ', date: d(2), startDate: d(2) }],
  cashCounts: [{ id: 'c1', stash: 'Wallet', denoms: { 10000: 12 }, country: 'JP', date: d(1) }],
}

// The history sheet shows every row but only COUNTS the ones after the
// cutoff — the same rule the balance applies. This is that filter.
const counted = (rows, account) => {
  const since = cutoffFor(account)
  return rows.filter((r) => !r.date || r.date >= since)
}

describe('AUDIT 1 · an account history explains its balance exactly', () => {
  for (const account of ACCOUNTS) {
    it(`${account.label}: history sums to balance − opening`, () => {
      const balance = accountBalance(account, DATA, ACCOUNTS)
      const rows = counted(
        buildHistory(account.label, {
          ...DATA,
          country: account.country,
          fromCountry: 'JP', // the only self transfer here comes from MUFJ
        }),
        account
      )
      const movement = rows.reduce((s, r) => s + r.amount, 0)
      expect(Math.round(movement * 100) / 100).toBe(
        Math.round((balance - account.openingBalance) * 100) / 100
      )
    })
  }
})

describe('AUDIT 2 · both halves of a paired movement agree', () => {
  const places = moneyPlaces(ACCOUNTS)
  const P = (k) => findPlace(places, k)

  it('a Move money between two accounts nets to zero across the pair', () => {
    const ops = moveOps({
      from: P('account:ICICI NRE'),
      to: P('account:ICICI NRO'),
      amount: 8335.25,
      date: d(9),
    })
    const entries = ops.filter((o) => o.name === 'accountEntries').map((o, i) => ({ id: `m${i}`, ...o.data }))
    const data = { ...DATA, accountEntries: [...DATA.accountEntries, ...entries] }

    const before = ACCOUNTS.map((a) => accountBalance(a, DATA, ACCOUNTS))
    const after = ACCOUNTS.map((a) => accountBalance(a, data, ACCOUNTS))
    const delta = after.reduce((s, v, i) => s + (v - before[i]), 0)
    expect(Math.round(delta * 100) / 100).toBe(0)
  })

  it('a self transfer moves the sending and receiving accounts by the same event', () => {
    const mufj = accountBalance(ACCOUNTS[0], DATA, ACCOUNTS)
    const nre = accountBalance(ACCOUNTS[2], DATA, ACCOUNTS)
    const without = { ...DATA, transfers: DATA.transfers.filter((t) => t.id !== 't1') }
    expect(accountBalance(ACCOUNTS[0], without, ACCOUNTS) - mufj).toBe(100000) // sent
    expect(accountBalance(ACCOUNTS[2], without, ACCOUNTS) - nre).toBe(-55000) // received
  })

  it('a withdrawal leaves the bank and arrives in cash, once each', () => {
    const bank = accountBalance(ACCOUNTS[0], DATA, ACCOUNTS)
    const without = { ...DATA, withdrawals: [] }
    expect(accountBalance(ACCOUNTS[0], without, ACCOUNTS) - bank).toBe(30000)

    const cash = cashPosition({ counts: DATA.cashCounts, ...DATA, country: 'JP' })
    const cashWithout = cashPosition({ counts: DATA.cashCounts, ...without, country: 'JP' })
    expect(cash.expected - cashWithout.expected).toBe(30000)
  })
})

describe('AUDIT 3 · nothing is counted twice', () => {
  it('a card top-up leaves the paying account once, not once per screen', () => {
    const bank = accountBalance(ACCOUNTS[0], DATA, ACCOUNTS)
    const without = { ...DATA, recharges: [] }
    expect(accountBalance(ACCOUNTS[0], without, ACCOUNTS) - bank).toBe(5000)
  })

  it('a transfer fee is inside the amount sent, never added on top', () => {
    const bank = accountBalance(ACCOUNTS[0], DATA, ACCOUNTS)
    const noFee = { ...DATA, transfers: DATA.transfers.map((t) => ({ ...t, fee: 0 })) }
    expect(accountBalance(ACCOUNTS[0], noFee, ACCOUNTS)).toBe(bank)
  })

  it('cash spending never touches a bank balance', () => {
    const bank = accountBalance(ACCOUNTS[0], DATA, ACCOUNTS)
    const noCashSpend = { ...DATA, expenses: DATA.expenses.filter((e) => e.paymentMethod !== 'Cash') }
    expect(accountBalance(ACCOUNTS[0], noCashSpend, ACCOUNTS)).toBe(bank)
  })

  it('rupee spending never moves a yen balance, and the reverse', () => {
    const mufj = accountBalance(ACCOUNTS[0], DATA, ACCOUNTS)
    const nro = accountBalance(ACCOUNTS[1], DATA, ACCOUNTS)
    // The rupee expenses belong to NRO only.
    expect(mufj).not.toBe(nro)
    expect(nro).toBe(15941.25 - 5056 - 18000)
  })

  it('the cash ledger sums to exactly the drift it reports', () => {
    const args = { counts: DATA.cashCounts, ...DATA, country: 'JP' }
    const pos = cashPosition(args)
    const net = cashLedger(args).reduce((s, r) => s + r.amount, 0)
    expect(net).toBe(pos.expected - pos.counted)
  })
})

describe('AUDIT 4 · everything recorded is findable in the History feed', () => {
  const feed = buildActivityFeed({
    expenses: DATA.expenses,
    income: DATA.income,
    transfers: DATA.transfers,
    recharges: DATA.recharges,
    withdrawals: DATA.withdrawals,
    officeItems: DATA.officeItems,
    passes: DATA.passes,
    accountEntries: DATA.accountEntries,
    cashCounts: DATA.cashCounts,
  })

  it('carries every record, none dropped', () => {
    const written =
      DATA.expenses.length +
      DATA.income.length +
      DATA.transfers.length +
      DATA.recharges.length +
      DATA.withdrawals.length +
      DATA.officeItems.length +
      DATA.passes.length +
      DATA.accountEntries.length +
      DATA.cashCounts.length
    expect(feed.length).toBe(written)
  })

  it('every row has a date, so nothing sorts into the void', () => {
    expect(feed.every((r) => r.date instanceof Date && !Number.isNaN(r.date.getTime()))).toBe(true)
  })

  it('is ordered newest first', () => {
    const times = feed.map((r) => r.date.getTime())
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })
})

describe('AUDIT 5 · the reconcile cutoff is reported, not just applied', () => {
  const account = { label: 'ICICI NRO', country: 'IN', openingBalance: 15941.25, openingBalanceAt: new Date(2026, 7, 9) }
  const data = {
    expenses: [
      { id: 'e1', amount: 5056, paymentMethod: 'ICICI NRO', date: new Date(2026, 7, 8, 12) },
      { id: 'e2', amount: 18000, paymentMethod: 'ICICI NRO', date: new Date(2026, 7, 8, 12) },
    ],
  }

  it('ignores spending logged before the opening balance was set', () => {
    // This is correct — the balance typed from the bank app already includes
    // that spending. What was wrong was doing it in silence.
    expect(accountBalance(account, data, [account])).toBe(15941.25)
  })

  it('says how much it is ignoring, and from when', () => {
    const hidden = ignoredBeforeCutoff(account, data)
    expect(hidden.count).toBe(2)
    expect(hidden.total).toBe(23056)
    expect(startOfDay(hidden.since).getTime()).toBe(new Date(2026, 7, 9).getTime())
  })

  it('reports nothing hidden for an account with no reconcile point', () => {
    const fromZero = { label: 'ICICI NRO', country: 'IN' }
    expect(ignoredBeforeCutoff(fromZero, data)).toEqual({ count: 0, total: 0, since: null })
    // …and counts everything, because there is no anchor to restart from.
    expect(accountBalance(fromZero, data, [fromZero])).toBe(-23056)
  })

  it('counts a record dated the same DAY as the opening balance', () => {
    const sameDay = {
      expenses: [{ id: 'x', amount: 100, paymentMethod: 'ICICI NRO', date: new Date(2026, 7, 9, 12) }],
    }
    expect(accountBalance(account, sameDay, [account])).toBe(15941.25 - 100)
  })
})

describe('AUDIT 6 · dates are never silently lost', () => {
  it('a record with no date is not counted toward a balance', () => {
    const account = { label: 'MUFJ', country: 'JP', openingBalance: 1000, openingBalanceAt: new Date(2026, 0, 1) }
    const data = { expenses: [{ id: 'x', amount: 500, paymentMethod: 'MUFJ' }] }
    // Firestore orders by `date`; a record without one never arrives at all,
    // so counting it here would show money the app can never list.
    expect(accountBalance(account, data, [account])).toBe(1000)
  })

  it('toDate survives a Firestore Timestamp as well as a Date', () => {
    const stamp = { toDate: () => new Date(2026, 7, 8, 12) }
    expect(toDate(stamp).getTime()).toBe(new Date(2026, 7, 8, 12).getTime())
  })
})

describe('AUDIT 7 · a move is one event in History, not two', () => {
  const places = moneyPlaces(ACCOUNTS)
  const ops = moveOps({
    from: findPlace(places, 'account:ICICI NRE'),
    to: findPlace(places, 'account:ICICI NRO'),
    amount: 8335.25,
    date: d(9),
  })
  const entries = ops
    .filter((o) => o.name === 'accountEntries')
    .map((o, i) => ({ id: `m${i}`, ...o.data }))

  it('writes both halves with the same moveId', () => {
    expect(entries).toHaveLength(2)
    expect(entries[0].moveId).toBe(entries[1].moveId)
    expect(entries.map((e) => e.direction).sort()).toEqual(['credit', 'debit'])
  })

  it('shows up as ONE row, naming both ends', () => {
    const feed = buildActivityFeed({ accountEntries: entries })
    expect(feed).toHaveLength(1)
    expect(feed[0].kind).toBe('Moved')
    expect(feed[0].title).toBe('ICICI NRE → ICICI NRO')
    expect(feed[0].amount).toBe(8335.25)
  })

  it('reads as neither spending nor income — you still have the money', () => {
    const feed = buildActivityFeed({ accountEntries: entries })
    expect(feed[0].tone).toBe('neutral')
  })

  it('still lists a plain hand-logged credit on its own', () => {
    const feed = buildActivityFeed({
      accountEntries: [
        ...entries,
        { id: 'x', account: 'ICICI NRE', direction: 'credit', amount: 1200, reason: 'Interest', date: d(12) },
      ],
    })
    expect(feed).toHaveLength(2)
    expect(feed.find((r) => r.kind === 'Credited').title).toBe('Interest')
  })

  it('the one row still reflects the real two-sided balance change', () => {
    const data = { ...DATA, accountEntries: [...DATA.accountEntries, ...entries] }
    const nre = accountBalance(ACCOUNTS[2], data, ACCOUNTS)
    const nro = accountBalance(ACCOUNTS[1], data, ACCOUNTS)
    expect(nre).toBe(accountBalance(ACCOUNTS[2], DATA, ACCOUNTS) - 8335.25)
    expect(nro).toBe(accountBalance(ACCOUNTS[1], DATA, ACCOUNTS) + 8335.25)
  })
})
