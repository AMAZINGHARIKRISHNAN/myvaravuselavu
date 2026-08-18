// What one account is worth, from its reconcile point onward.
//
// Extracted from useAccountBalances so it can be TESTED AGAINST buildHistory.
// Those two have to agree exactly — the history sheet exists to explain the
// balance, and a row that appears in one and not the other is a number the
// user cannot check. While the rules lived inside a React hook there was no
// way to assert that, and they drifted.
//
// Every movement is matched by the field that names this account:
//   expenses        paymentMethod   money spent from here
//   income          account         money that landed here
//   transfers       fromAccount     what was sent (the fee is inside it)
//   transfers       toAccount       what arrived, in this account's currency
//   accountEntries  account         hand-logged in/out, and both halves of a
//                                   Move money between two of your places
//   pasmoRecharges  paidFrom        this account paid for a card top-up
//   officeItems     paidWith        money fronted for the office
//   withdrawals     account         cash taken out of here
//   commutePasses   paidFrom        a pass, and its refundable deposit
import { toDate, startOfDay } from './format'
import { passSpentFrom, passDeduction } from './passes'
import { transferCredit } from './wallet'

// The reconcile point: everything dated before it is already baked into the
// opening balance you typed, so counting it again would deduct it twice.
// Read as MIDNIGHT of its day — a balance typed at 11pm still counts what was
// logged that morning.
export const cutoffFor = (account) =>
  account?.openingBalanceAt ? startOfDay(account.openingBalanceAt) : new Date(0)

const countsToward = (record, since) => {
  const d = toDate(record?.date)
  return Boolean(d) && d >= since
}

// Every way money reaches or leaves an account — ONE list, read by both
// functions below.
//
// They used to keep two hand-written lists and they drifted: a transfer
// arriving and a commuter pass were missing from the explanation, so an
// account whose hidden history was exactly those was told nothing was hidden
// while its number sat unexplained. Adding a movement now means adding a row
// here, and both functions see it.
//
// The two DO read the same movement differently in three places, on purpose.
// Those differences are spelled out as fields rather than left implicit in two
// loops, because that is precisely what a de-duplication would otherwise erase:
//
//   · `sign` — the balance is signed; the hidden tally is a magnitude ("how
//     much is not being counted"), so it ignores sign entirely
//   · `hiddenAmount` — a transfer ARRIVING is valued knowing its source
//     account when balancing, and without that lookup when explaining
//   · `balance` / `hiddenDate` — a pass names its source through
//     passDeduction (cost and deposit can come from different places), so it
//     has no single field to match on
const SOURCES = [
  { key: 'expenses', field: 'paymentMethod', sign: -1, amount: (r) => r.amount },
  { key: 'income', field: 'account', sign: 1, amount: (r) => r.amount },
  // The fee is taken OUT of the amount sent, so `amountSent` is the whole
  // debit — adding the fee on top would charge for it twice.
  { key: 'transfers', field: 'fromAccount', sign: -1, amount: (r) => r.amountSent },
  {
    key: 'transfers',
    field: 'toAccount',
    sign: 1,
    amount: (r, { account, accounts }) =>
      transferCredit(r, account.country, accounts.find((a) => a.label === r.fromAccount)?.country ?? null),
    hiddenAmount: (r, { account }) => transferCredit(r, account.country),
  },
  {
    key: 'accountEntries',
    field: 'account',
    sign: (r) => (r.direction === 'debit' ? -1 : 1),
    amount: (r) => r.amount,
  },
  { key: 'recharges', field: 'paidFrom', sign: -1, amount: (r) => r.amount },
  { key: 'officeItems', field: 'paidWith', sign: -1, amount: (r) => r.amount },
  { key: 'withdrawals', field: 'account', sign: -1, amount: (r) => r.amount },
  {
    key: 'passes',
    // Kept as the aggregate call rather than re-implemented as a loop:
    // passSpentFrom treats a pass with no date as time zero, where
    // countsToward rejects a missing date outright. Rewriting it would move
    // that edge, and this refactor is not allowed to move anything.
    balance: (rows, { label, since }) => -passSpentFrom(rows, label, since.getTime()),
    hiddenAmount: (p, { label }) => passDeduction(p, label),
    hiddenDate: (p) => p.date ?? p.startDate,
  },
]

export function accountBalance(account, data = {}, accounts = []) {
  const label = account.label
  const since = cutoffFor(account)
  const ctx = { account, accounts, label, since }
  let balance = account.openingBalance ?? 0

  for (const source of SOURCES) {
    const rows = data[source.key] || []
    if (source.balance) {
      balance += source.balance(rows, ctx)
      continue
    }
    for (const r of rows) {
      if (r[source.field] !== label || !countsToward(r, since)) continue
      const sign = typeof source.sign === 'function' ? source.sign(r) : source.sign
      balance += sign * (source.amount(r, ctx) || 0)
    }
  }

  return balance
}

// How much of this account's history the opening balance is hiding.
//
// Records dated before the reconcile point are deliberately ignored — but
// silently, which is what makes a balance look broken: three expenses sit in
// the History page and the account has not moved. This counts them so a screen
// can say so out loud.
export function ignoredBeforeCutoff(account, data = {}) {
  const since = cutoffFor(account)
  if (!account?.openingBalanceAt) return { count: 0, total: 0, since: null }

  const label = account.label
  const ctx = { account, accounts: [], label, since }
  let count = 0
  let total = 0
  const before = (when, amount) => {
    const d = toDate(when)
    if (!d || d >= since) return
    count += 1
    total += amount || 0
  }

  for (const source of SOURCES) {
    const rows = data[source.key] || []
    const amountOf = source.hiddenAmount || source.amount
    for (const r of rows) {
      // A pass is matched by what it actually deducts from this account, not
      // by a field — and one that deducts nothing was never this account's to
      // explain.
      if (source.hiddenDate) {
        const out = amountOf(r, ctx)
        if (out > 0) before(source.hiddenDate(r), out)
        continue
      }
      if (r[source.field] !== label) continue
      // Unsigned on purpose: this answers "how much is not being counted",
      // and a hidden debit hides money just as a hidden credit does.
      before(r.date, amountOf(r, ctx))
    }
  }

  return { count, total, since }
}
