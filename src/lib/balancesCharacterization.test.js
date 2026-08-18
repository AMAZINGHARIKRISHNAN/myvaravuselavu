import { describe, it, expect } from 'vitest'
import { accountBalance, ignoredBeforeCutoff, cutoffFor } from './balances'

// CHARACTERIZATION TESTS — these pin what the code does TODAY.
//
// Written before de-duplicating the two collection lists inside balances.js, so
// the refactor can be proven to change nothing. Every number here was produced
// by the pre-refactor implementation and then verified by hand, so a failure
// means a real behaviour change rather than a fixture drifting.
//
// They are deliberately about OUTPUT, not structure: no assertion here knows
// how the sums are organised internally, which is what makes them survive a
// rewrite of the inside.

const d = (iso) => new Date(iso)

const ACCOUNTS = [
  { id: 'a1', label: 'MUFJ', country: 'JP', openingBalance: 100000, openingBalanceAt: d('2026-07-01T00:00:00') },
  { id: 'a2', label: 'ICICI', country: 'IN', openingBalance: 50000, openingBalanceAt: d('2026-07-01T00:00:00') },
  // No reconcile point: everything counts, and nothing is ever "hidden".
  { id: 'a3', label: 'PNB', country: 'IN', openingBalance: 2000 },
]
const [MUFJ, ICICI, PNB] = ACCOUNTS

// One fixture exercising every movement type, on both sides of the cutoff, in
// both currencies, including records belonging to other accounts entirely.
const DATA = {
  expenses: [
    { id: 'e1', paymentMethod: 'MUFJ', amount: 3200, date: d('2026-07-10T12:00:00') },
    { id: 'e2', paymentMethod: 'MUFJ', amount: 900, date: d('2026-06-20T12:00:00') }, // before
    { id: 'e3', paymentMethod: 'ICICI', amount: 1500, date: d('2026-07-12T12:00:00') },
    { id: 'e4', paymentMethod: 'Cash', amount: 500, date: d('2026-07-12T12:00:00') }, // not an account
  ],
  income: [
    { id: 'i1', account: 'MUFJ', amount: 300000, date: d('2026-07-25T12:00:00') },
    { id: 'i2', account: 'MUFJ', amount: 280000, date: d('2026-06-25T12:00:00') }, // before
    { id: 'i3', account: 'PNB', amount: 4000, date: d('2026-07-05T12:00:00') },
  ],
  transfers: [
    // JP → IN: different currencies, so what ARRIVES is amountReceived.
    { id: 't1', fromAccount: 'MUFJ', toAccount: 'ICICI', amountSent: 50000, amountReceived: 27000, date: d('2026-07-20T12:00:00') },
    { id: 't2', fromAccount: 'MUFJ', toAccount: 'ICICI', amountSent: 40000, amountReceived: 22000, date: d('2026-06-15T12:00:00') }, // before
    // IN → IN: same currency, so what arrives is what was sent.
    { id: 't3', fromAccount: 'ICICI', toAccount: 'PNB', amountSent: 5000, date: d('2026-07-22T12:00:00') },
    { id: 't4', fromAccount: 'MUFJ', amountSent: 10000, date: d('2026-07-28T12:00:00') }, // to family, no toAccount
  ],
  accountEntries: [
    { id: 'ae1', account: 'MUFJ', direction: 'credit', amount: 1200, date: d('2026-07-11T12:00:00') },
    { id: 'ae2', account: 'MUFJ', direction: 'debit', amount: 800, date: d('2026-07-13T12:00:00') },
    { id: 'ae3', account: 'MUFJ', direction: 'debit', amount: 400, date: d('2026-06-13T12:00:00') }, // before
    { id: 'ae4', account: 'ICICI', direction: 'credit', amount: 600, date: d('2026-07-14T12:00:00') },
  ],
  recharges: [
    { id: 'r1', card: 'Pasmo', paidFrom: 'MUFJ', amount: 3000, date: d('2026-07-16T12:00:00') },
    { id: 'r2', card: 'Pasmo', paidFrom: 'MUFJ', amount: 2000, date: d('2026-06-16T12:00:00') }, // before
  ],
  officeItems: [
    { id: 'o1', paidWith: 'MUFJ', amount: 5000, date: d('2026-07-18T12:00:00') },
    { id: 'o2', paidWith: 'MUFJ', amount: 1500, date: d('2026-06-18T12:00:00') }, // before
  ],
  withdrawals: [
    { id: 'w1', account: 'MUFJ', amount: 20000, date: d('2026-07-19T12:00:00') },
    { id: 'w2', account: 'MUFJ', amount: 10000, date: d('2026-06-19T12:00:00') }, // before
  ],
  passes: [
    { id: 'p1', paidFrom: 'MUFJ', cost: 20000, deposit: 500, date: d('2026-07-05T12:00:00') },
    { id: 'p2', paidFrom: 'MUFJ', cost: 18000, date: d('2026-06-05T12:00:00') }, // before
    { id: 'p3', paidFrom: 'Cash', cost: 9000, date: d('2026-07-06T12:00:00') }, // someone else's
  ],
}

describe('accountBalance — pinned output', () => {
  // 100000 − 3200 + 300000 − 50000 − 10000 + 1200 − 800 − 3000 − 5000 − 20000
  //   − 20000 (the pass bought after the cutoff) = 289200
  it('MUFJ', () => {
    expect(accountBalance(MUFJ, DATA, ACCOUNTS)).toBe(289200)
  })

  // 50000 − 1500 + 27000 (arrived as rupees) − 5000 + 600 = 71100
  it('ICICI', () => {
    expect(accountBalance(ICICI, DATA, ACCOUNTS)).toBe(71100)
  })

  // No cutoff, so everything counts: 2000 + 4000 + 5000 (a rupee-to-rupee
  // transfer arrives as exactly what left) = 11000
  it('PNB — no reconcile point', () => {
    expect(accountBalance(PNB, DATA, ACCOUNTS)).toBe(11000)
  })

  it('is just the opening balance with no data at all', () => {
    expect(accountBalance(MUFJ, {}, ACCOUNTS)).toBe(100000)
    expect(accountBalance({ label: 'X' }, {}, [])).toBe(0)
  })
})

describe('ignoredBeforeCutoff — pinned output', () => {
  // 900 + 280000 + 40000 + 400 + 2000 + 1500 + 10000 + 18000 = 352800
  it('MUFJ counts eight hidden records', () => {
    const hidden = ignoredBeforeCutoff(MUFJ, DATA)
    expect(hidden.count).toBe(8)
    expect(hidden.total).toBe(352800)
    expect(hidden.since).toEqual(cutoffFor(MUFJ))
  })

  // Only t2 arriving. Note the deliberate asymmetry: the balance computes an
  // arriving transfer knowing its SOURCE account, this tally does not — it
  // takes transferCredit(r, account.country) with no source. Pinned so the
  // difference survives any refactor.
  it('ICICI counts the arriving transfer, valued without the source account', () => {
    const hidden = ignoredBeforeCutoff(ICICI, DATA)
    expect(hidden.count).toBe(1)
    expect(hidden.total).toBe(22000)
  })

  it('reports nothing hidden for an account with no reconcile point', () => {
    expect(ignoredBeforeCutoff(PNB, DATA)).toEqual({ count: 0, total: 0, since: null })
  })

  it('reports nothing for an account with no data', () => {
    expect(ignoredBeforeCutoff(MUFJ, {}).count).toBe(0)
  })
})

// The three places the two functions deliberately read the same movement
// differently. A de-duplication that "tidied" any of these would move a number.
describe('pinned asymmetries between the two', () => {
  const at = (iso) => d(iso)

  it('a hand-logged debit is signed in the balance but counted raw in the tally', () => {
    const acct = { label: 'A', country: 'JP', openingBalance: 0, openingBalanceAt: at('2026-07-01T00:00:00') }
    const debitBefore = { accountEntries: [{ id: 'x', account: 'A', direction: 'debit', amount: 700, date: at('2026-06-01T12:00:00') }] }
    const debitAfter = { accountEntries: [{ id: 'y', account: 'A', direction: 'debit', amount: 700, date: at('2026-07-05T12:00:00') }] }

    expect(accountBalance(acct, debitAfter, [])).toBe(-700) // signed
    expect(ignoredBeforeCutoff(acct, debitBefore).total).toBe(700) // unsigned
  })

  it('a pass counts once in the balance and once in the tally, never both', () => {
    const acct = { label: 'A', country: 'JP', openingBalance: 0, openingBalanceAt: at('2026-07-01T00:00:00') }
    const before = { passes: [{ id: 'p', paidFrom: 'A', cost: 12000, date: at('2026-06-02T12:00:00') }] }
    const after = { passes: [{ id: 'p', paidFrom: 'A', cost: 12000, date: at('2026-07-02T12:00:00') }] }

    expect(accountBalance(acct, before, [])).toBe(0) // before the cutoff: skipped
    expect(ignoredBeforeCutoff(acct, before).count).toBe(1) // and therefore explained
    expect(accountBalance(acct, after, [])).toBe(-12000) // after: deducted
    expect(ignoredBeforeCutoff(acct, after).count).toBe(0) // and not explained
  })

  it("a pass someone else paid for touches neither", () => {
    const acct = { label: 'A', country: 'JP', openingBalance: 0, openingBalanceAt: at('2026-07-01T00:00:00') }
    const other = { passes: [{ id: 'p', paidFrom: 'Cash', cost: 9000, date: at('2026-06-02T12:00:00') }] }
    expect(accountBalance(acct, other, [])).toBe(0)
    expect(ignoredBeforeCutoff(acct, other).count).toBe(0)
  })
})

// The property the two functions exist to satisfy together: everything that
// names this account is either counted in the balance or explained as hidden.
// Nothing may fall between them — that gap is what made an account look broken.
describe('every record is either counted or explained', () => {
  it('accounts for all eight MUFJ records that predate the cutoff', () => {
    const hidden = ignoredBeforeCutoff(MUFJ, DATA)
    const namesMufj = [
      ...DATA.expenses.filter((r) => r.paymentMethod === 'MUFJ'),
      ...DATA.income.filter((r) => r.account === 'MUFJ'),
      ...DATA.transfers.filter((r) => r.fromAccount === 'MUFJ' || r.toAccount === 'MUFJ'),
      ...DATA.accountEntries.filter((r) => r.account === 'MUFJ'),
      ...DATA.recharges.filter((r) => r.paidFrom === 'MUFJ'),
      ...DATA.officeItems.filter((r) => r.paidWith === 'MUFJ'),
      ...DATA.withdrawals.filter((r) => r.account === 'MUFJ'),
      ...DATA.passes.filter((r) => r.paidFrom === 'MUFJ'),
    ]
    const since = cutoffFor(MUFJ)
    const beforeCount = namesMufj.filter((r) => new Date(r.date) < since).length
    expect(hidden.count).toBe(beforeCount)
  })
})
