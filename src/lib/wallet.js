// Wallet math for the Balances page: prepaid cards (Pasmo, Edenred) and the
// per-source transaction history behind every balance.
import { toDate } from './format'
import { passSpentFrom, passDeduction } from './passes'

export const PREPAID_CARDS = [
  { name: 'Pasmo', emoji: '💳' },
  // nimoca: the Kyushu transit card the bus commuter pass is loaded on.
  { name: 'nimoca', emoji: '🚌' },
  // company: the employer loads it — top-ups never come from the user's own
  // accounts, so no "paid from" and no deduction anywhere.
  { name: 'Edenred', emoji: '🍴', company: true },
]

// The company loads ¥10,000 onto Edenred on the 16th of every month; the
// app credits it automatically on the first open on/after that day.
export const EDENRED_MONTHLY = { day: 16, amount: 10000 }

// What a transfer actually puts INTO the account it was sent to. A remittance
// lands in India as rupees (amountReceived); the rare yen-to-yen self transfer
// lands as the yen that were sent. The account's own country decides which.
export function transferCredit(transfer, country = 'IN') {
  return country === 'JP' ? transfer.amountSent || 0 : transfer.amountReceived || 0
}

const timeOf = (r) => {
  const d = r.date
  if (!d) return 0
  return typeof d.toDate === 'function' ? d.toDate().getTime() : new Date(d).getTime()
}

// Prepaid card balance = top-ups − everything paid with that card, app-wide.
// Old recharge records predate the `card` field and were all Pasmo.
//
// "Set exact balance" records (setTo) are RECONCILE POINTS: the balance
// restarts from that declared number, and anything dated before it is
// ignored — so backfilling months of old expenses never re-deducts from a
// balance that already reflects them.
// `officeItems` are out-of-pocket claims paid WITH this card — the office
// repays them later, but the card is lighter right now. `passes` are commuter
// passes / deposits recharged onto this card (e.g. a pass loaded on Pasmo).
export function cardBalance(card, recharges, expenses, officeItems = [], passes = []) {
  const cardRecharges = recharges.filter((r) => (r.card || 'Pasmo') === card)
  const anchor = cardRecharges
    .filter((r) => r.setTo !== undefined && r.setTo !== null)
    .sort((a, b) => timeOf(b) - timeOf(a))[0]
  const since = anchor ? timeOf(anchor) : -Infinity
  const base = anchor ? anchor.setTo : 0

  const loaded = cardRecharges
    .filter((r) => r !== anchor && timeOf(r) > since)
    .reduce((s, r) => s + (r.amount || 0), 0)
  const spent = expenses
    .filter((e) => e.paymentMethod === card && timeOf(e) > since)
    .reduce((s, e) => s + (e.amount || 0), 0)
  const fronted = officeItems
    .filter((i) => i.paidWith === card && timeOf(i) > since)
    .reduce((s, i) => s + (i.amount || 0), 0)
  const passOut = passSpentFrom(passes, card, since)
  return base + loaded - spent - fronted - passOut
}

// Everything that touched one payment source, newest first, as signed rows:
//   expenses  (paymentMethod match) → negative
//   income    (account match)      → positive
//   transfers (fromAccount match)  → negative (the amount sent; the fee is
//                                     inside it, never added on top)
//   transfers (toAccount match)    → positive: a self transfer landing in your
//                                    own Indian account, in INR
//   recharges (card match)         → positive top-up onto the card
//   recharges (paidFrom match)     → negative: the account that PAID for a
//                                    top-up loses that money (bank → card)
// Mirrors the matching rules in useAccountBalances so a row's history always
// explains its balance.
export function buildHistory(
  name,
  {
    expenses = [],
    income = [],
    transfers = [],
    recharges = [],
    officeItems = [],
    passes = [],
    withdrawals = [],
    accountEntries = [],
    // The source's own country — decides which side of a transfer lands here,
    // and which currency's cash this is. Unset means "a transfer destination
    // in India, cash in yen": the two defaults that were true before rupee
    // cash and yen-to-yen self transfers existed.
    country = null,
  } = {}
) {
  const rows = []
  // 'Cash' is the one source that holds two currencies. Its rows follow the
  // same rule cashPosition uses: a rupee cash buy can't come out of the yen in
  // your pocket, and yen-only movements (card top-ups, passes, office money
  // fronted, cash income) never touch the rupee side.
  const isCash = name === 'Cash'
  const cashCountry = country || 'JP'
  const cashJP = !isCash || cashCountry === 'JP'
  for (const e of expenses) {
    if (e.paymentMethod !== name) continue
    if (isCash && (e.country || 'JP') !== cashCountry) continue
    rows.push({
      id: `e-${e.id}`,
      date: toDate(e.date),
      label: e.note?.trim() || e.category || 'Expense',
      amount: -(e.amount || 0),
      kind: 'expense',
    })
  }
  for (const r of income) {
    if (r.account !== name) continue
    if (isCash && !cashJP) continue
    rows.push({
      id: `i-${r.id}`,
      date: toDate(r.date),
      label: r.note?.trim() || r.source || 'Income',
      amount: r.amount || 0,
      kind: 'income',
    })
  }
  for (const t of transfers) {
    if (t.fromAccount === name) {
      rows.push({
        id: `t-${t.id}`,
        date: toDate(t.date),
        label: 'Transfer sent',
        amount: -(t.amountSent || 0), // the fee comes out of this, not on top
        kind: 'transfer',
      })
    }
    // The other side of a self transfer: the account that received it, in its
    // own currency. The same record drives both sides, so they always agree.
    if (t.toAccount && t.toAccount === name) {
      rows.push({
        id: `tr-${t.id}`,
        date: toDate(t.date),
        label: `Received from ${t.fromAccount || 'Japan'}`,
        amount: transferCredit(t, country),
        kind: 'transfer',
      })
    }
  }

  // Hand-logged money in/out of an account: interest, a bank fee, a UPI credit
  // — anything that moved the balance without being an expense or a salary.
  for (const a of accountEntries) {
    if (a.account !== name) continue
    rows.push({
      id: `ae-${a.id}`,
      recordId: a.id,
      collection: 'accountEntries',
      date: toDate(a.date),
      label: a.reason?.trim() || (a.direction === 'debit' ? 'Debited' : 'Credited'),
      amount: a.direction === 'debit' ? -(a.amount || 0) : a.amount || 0,
      kind: 'adjust',
    })
  }
  for (const r of recharges) {
    // recordId is what a screen needs to undo the thing: deleting the one
    // top-up document reverses BOTH sides at once (card down, account back
    // up), because every balance is derived from it rather than stored.
    if ((r.card || 'Pasmo') === name) {
      rows.push({
        id: `r-${r.id}`,
        recordId: r.id,
        collection: 'pasmoRecharges',
        date: toDate(r.date),
        label: r.note?.trim() || `Top-up${r.paidFrom ? ` from ${r.paidFrom}` : ''}`,
        amount: r.amount || 0,
        kind: 'recharge',
      })
    }
    if (r.paidFrom && r.paidFrom === name && cashJP) {
      rows.push({
        id: `rp-${r.id}`,
        recordId: r.id,
        collection: 'pasmoRecharges',
        date: toDate(r.date),
        label: `Top-up to ${r.card || 'Pasmo'}`,
        amount: -(r.amount || 0),
        kind: 'recharge',
      })
    }
  }
  // Money fronted for the office from this source. Shown so the balance is
  // always explainable; the matching income appears when the report is paid.
  for (const i of officeItems) {
    if (i.paidWith !== name || !cashJP) continue
    rows.push({
      id: `o-${i.id}`,
      recordId: i.id,
      collection: 'officeReimbursements',
      date: toDate(i.date),
      label: `Fronted for office · ${i.item || 'Expense'}`,
      amount: -(i.amount || 0),
      kind: 'office',
    })
  }
  // Withdrawals: the account they came out of goes down; Cash goes up.
  for (const w of withdrawals) {
    if (w.account === name) {
      rows.push({
        id: `w-${w.id}`,
        recordId: w.id,
        collection: 'withdrawals',
        date: toDate(w.date),
        label: w.note?.trim() || 'Cash withdrawal',
        amount: -(w.amount || 0),
        kind: 'withdrawal',
      })
    }
    if (isCash && (w.country || 'JP') === cashCountry) {
      rows.push({
        id: `wc-${w.id}`,
        recordId: w.id,
        collection: 'withdrawals',
        date: toDate(w.date),
        label: `Withdrawn from ${w.account || 'bank'}`,
        amount: w.amount || 0,
        kind: 'withdrawal',
      })
    }
  }

  // Commuter passes and their refundable deposits, from whichever source paid.
  for (const p of passes) {
    const out = passDeduction(p, name)
    if (out <= 0) continue
    rows.push({
      id: `pass-${p.id}`,
      recordId: p.id,
      collection: 'commutePasses',
      date: toDate(p.date ?? p.startDate),
      label: p.label || 'Commuter pass',
      amount: -out,
      kind: 'pass',
    })
  }
  return rows.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
}
