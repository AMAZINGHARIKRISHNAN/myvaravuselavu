// Wallet math for the Balances page: prepaid cards (Pasmo, Edenred) and the
// per-source transaction history behind every balance.
import { toDate } from './format'
import { countryOf } from './money'
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

// Is this month's company credit still owed, and which month is it for?
//
// Returns the month key to write, or null when there is nothing to do — either
// the 16th has not arrived yet, or this month has already been credited.
// `edenredLastCredit` in settings is the marker, so deleting a credit by hand
// does not make it reappear on the next app open.
//
// Pulled out as a pure function because the effect that used to run it lived
// in a component that stopped being rendered — the credit silently stopped
// happening and nothing noticed. A rule that can be tested cannot go quiet
// like that again.
export function edenredCreditDue(settings, now = new Date()) {
  if (!settings) return null
  if (now.getDate() < EDENRED_MONTHLY.day) return null
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return settings.edenredLastCredit === monthKey ? null : monthKey
}

// The record that credit becomes. A FIXED id per month is what makes it safe:
// two devices opening the app on the 16th write the same document, so the card
// is credited once, never twice.
export function edenredCreditOp(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  return {
    op: 'set',
    name: 'pasmoRecharges',
    id: `edenred-${monthKey}`,
    data: {
      card: 'Edenred',
      amount: EDENRED_MONTHLY.amount,
      setTo: null,
      paidFrom: null, // company money — nothing of yours is deducted
      auto: true,
      date: new Date(year, month - 1, EDENRED_MONTHLY.day, 12),
      note: 'Company credit (auto)',
    },
  }
}

// What a transfer actually puts INTO the account it was sent to.
//
// A remittance lands in India as rupees (amountReceived). A same-currency self
// transfer lands as exactly what left, because no currency changed — and that
// case used to credit ZERO: the rule was "an Indian destination gets
// amountReceived", so a rupee-to-rupee move with no exchange rate and no
// received figure silently moved nothing. Money appeared to leave one account
// and arrive nowhere, which is the worst way for a ledger to be wrong.
//
// `fromCountry` is what makes the difference knowable. Without it the old
// behaviour stands, so nothing that already worked changes.
export function transferCredit(transfer, country = 'IN', fromCountry = null) {
  // Same currency at both ends: what was sent is what arrived.
  if (fromCountry && fromCountry === country) return transfer.amountSent || 0
  if (country === 'JP') return transfer.amountSent || 0
  // A remittance whose received figure was never filled in is still a rupee
  // destination — crediting the yen figure would be worse than crediting none.
  return transfer.amountReceived || 0
}

// Every prepaid card here — Pasmo, nimoca, Edenred — is Japanese and holds yen,
// and countryOf now says so for any record naming one: a card's currency is a
// fact about the card, so a stored country that disagrees is simply overruled.
//
// That means a card expense is ALWAYS yen and this guard can no longer exclude
// one. It stays because the same helper reads office claims and cash rows,
// where the country is real and a rupee record genuinely must not deduct.
const isYen = (r) => countryOf(r) !== 'IN'

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
//
// The cutoff is INCLUSIVE (>=), and that matters more than it looks.
// parseDateInput() keeps the real clock time for anything dated today but
// collapses every past date to exactly noon — so a reconcile and an expense
// you both backdate to the same day land on the identical millisecond. With a
// strictly-greater cutoff that expense was silently dropped and the card read
// too high, which is the one direction a balance must never be wrong in.
// Counting live is unaffected: a balance read at 8pm still ignores a 1pm
// purchase, because 1pm is genuinely before it.
//
// `officeItems` are out-of-pocket claims paid WITH this card — the office
// repays them later, but the card is lighter right now. `passes` are commuter
// passes / deposits recharged onto this card (e.g. a pass loaded on Pasmo).
// The reconcile point a card's balance restarts from: the most recent "set
// exact balance" top-up, the figure it declared, and the moment it applies.
//
// Exported because the balance is not the only thing that needs it. The history
// sheet lists every row that ever touched the card, and without the anchor it
// listed rows the balance had deliberately skipped, totalled them, and showed a
// number that disagreed with the card — a Pasmo reading ¥310 above a list that
// summed to −¥190, with nothing to explain the gap. A bank account never had
// this problem because its cutoff was passed through; a card's was locked
// inside this function.
export function cardAnchor(card, recharges = []) {
  const anchor = recharges
    .filter((r) => (r.card || 'Pasmo') === card && r.setTo !== undefined && r.setTo !== null)
    .sort((a, b) => timeOf(b) - timeOf(a))[0]
  if (!anchor) return null
  // The RECORD, not its id: top-ups written before ids existed have none, and
  // matching on undefined === undefined silently picked the wrong one.
  return { record: anchor, since: toDate(anchor.date), opening: anchor.setTo }
}

export function cardBalance(card, recharges, expenses, officeItems = [], passes = []) {
  const cardRecharges = recharges.filter((r) => (r.card || 'Pasmo') === card)
  const anchor = cardAnchor(card, recharges)?.record ?? null
  const since = anchor ? timeOf(anchor) : -Infinity
  const base = anchor ? anchor.setTo : 0

  const loaded = cardRecharges
    // Another reconcile's `amount` is a correction artefact, not money loaded,
    // so no setTo record is ever added on top of the anchor it lost to.
    .filter((r) => r !== anchor && r.setTo == null && timeOf(r) >= since)
    .reduce((s, r) => s + (r.amount || 0), 0)
  const spent = expenses
    .filter((e) => e.paymentMethod === card && isYen(e) && timeOf(e) >= since)
    .reduce((s, e) => s + (e.amount || 0), 0)
  const fronted = officeItems
    .filter((i) => i.paidWith === card && isYen(i) && timeOf(i) >= since)
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
    // The country of the account a self transfer CAME from, when it is known.
    // Without it a rupee-to-rupee move credits nothing — see transferCredit.
    fromCountry = null,
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
  const isCard = PREPAID_CARDS.some((c) => c.name === name)
  // The reconcile that a card's balance restarts from is shown as the STARTING
  // figure, not as a row — listing its correction delta as well would count the
  // same adjustment twice and put the sheet's total back out of step.
  const anchorRecord = isCard ? (cardAnchor(name, recharges)?.record ?? null) : null
  for (const e of expenses) {
    if (e.paymentMethod !== name) continue
    if (isCash && countryOf(e) !== cashCountry) continue
    // A yen card never spent rupees — see cardBalance. Keeping this in step is
    // what makes the history explain the balance rather than contradict it.
    if (isCard && !isYen(e)) continue
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
      // `fromCountry` lets a same-currency move credit what was actually sent.
      rows.push({
        id: `tr-${t.id}`,
        date: toDate(t.date),
        label: `Received from ${t.fromAccount || 'Japan'}`,
        amount: transferCredit(t, country, fromCountry),
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
    if ((r.card || 'Pasmo') === name && r !== anchorRecord) {
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
