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

export function accountBalance(account, data = {}, accounts = []) {
  const {
    expenses = [],
    income = [],
    transfers = [],
    recharges = [],
    officeItems = [],
    passes = [],
    withdrawals = [],
    accountEntries = [],
  } = data

  const label = account.label
  const since = cutoffFor(account)
  let balance = account.openingBalance ?? 0

  for (const r of expenses) {
    if (r.paymentMethod === label && countsToward(r, since)) balance -= r.amount || 0
  }
  for (const r of income) {
    if (r.account === label && countsToward(r, since)) balance += r.amount || 0
  }
  for (const r of transfers) {
    // The fee is taken OUT of the amount sent, so `amountSent` is the whole
    // debit — adding the fee on top would charge for it twice.
    if (r.fromAccount === label && countsToward(r, since)) balance -= r.amountSent || 0
    if (r.toAccount === label && countsToward(r, since)) {
      const source = accounts.find((a) => a.label === r.fromAccount)
      balance += transferCredit(r, account.country, source?.country ?? null)
    }
  }
  for (const r of accountEntries) {
    if (r.account !== label || !countsToward(r, since)) continue
    balance += r.direction === 'debit' ? -(r.amount || 0) : r.amount || 0
  }
  for (const r of recharges) {
    if (r.paidFrom === label && countsToward(r, since)) balance -= r.amount || 0
  }
  for (const r of officeItems) {
    if (r.paidWith === label && countsToward(r, since)) balance -= r.amount || 0
  }
  for (const w of withdrawals) {
    if (w.account === label && countsToward(w, since)) balance -= w.amount || 0
  }
  balance -= passSpentFrom(passes, label, since.getTime())

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
  let count = 0
  let total = 0
  const before = (record, amount) => {
    const d = toDate(record?.date)
    if (!d || d >= since) return
    count += 1
    total += amount || 0
  }

  for (const r of data.expenses || []) if (r.paymentMethod === label) before(r, r.amount)
  for (const r of data.income || []) if (r.account === label) before(r, r.amount)
  for (const r of data.transfers || []) if (r.fromAccount === label) before(r, r.amountSent)
  // Both sides of a transfer, and passes. Left out originally, so an account
  // whose ignored history was a remittance arriving or a commuter pass was told
  // "0 records are dated before this balance" while its number sat unexplained.
  // This has to list exactly what accountBalance skips, or the explanation is
  // itself the thing that needs explaining.
  for (const r of data.transfers || [])
    if (r.toAccount === label) before(r, transferCredit(r, account.country))
  for (const r of data.accountEntries || []) if (r.account === label) before(r, r.amount)
  for (const r of data.recharges || []) if (r.paidFrom === label) before(r, r.amount)
  for (const r of data.officeItems || []) if (r.paidWith === label) before(r, r.amount)
  for (const w of data.withdrawals || []) if (w.account === label) before(w, w.amount)
  for (const p of data.passes || []) {
    // A pass not bought from this account deducts 0 — counting it would inflate
    // the tally with records that were never this account's to begin with.
    const out = passDeduction(p, label)
    if (out > 0) before({ date: p.date ?? p.startDate }, out)
  }

  return { count, total, since }
}
