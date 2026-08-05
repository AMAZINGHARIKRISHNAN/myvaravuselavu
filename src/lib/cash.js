// Physical cash on hand: what you can actually put your hands on, counted
// note by note and coin by coin, split across the places you keep it
// (wallet, locker, drawer…).
//
// A count is a RECONCILE POINT, exactly like a card's "set exact balance":
// you counted, so that number is the truth as of that moment. From there the
// app tracks what should have moved — cash spending out, cash income in —
// and shows the drift so you know when it's time to count again.
import { toDate } from './format'
import { passSpentFrom, passDeduction } from './passes'

// Notes and coins in circulation, biggest first. ¥2,000 notes are rare but
// real; ₹2,000 was withdrawn in 2023 so it isn't offered.
export const DENOMINATIONS = {
  JP: [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1],
  IN: [500, 200, 100, 50, 20, 10, 5, 2, 1],
}

// Where cash physically sits. The list is a starting point — a count can name
// any place, and whatever you type shows up from then on.
export const DEFAULT_STASHES = [
  { name: 'Wallet', emoji: '👛' },
  { name: 'Locker', emoji: '🔐' },
  { name: 'Home', emoji: '🏠' },
  { name: 'Envelope', emoji: '✉️' },
]

export const stashEmoji = (name) =>
  DEFAULT_STASHES.find((s) => s.name.toLowerCase() === (name || '').toLowerCase())?.emoji || '💵'

const timeOf = (r) => toDate(r?.date)?.getTime() || 0

// ¥10,000 × 3 + ¥1,000 × 2 = 32,000. Ignores blank/garbage entries.
export function countTotal(denoms = {}) {
  return Object.entries(denoms).reduce((sum, [value, qty]) => {
    const v = Number(value)
    const n = Number(qty)
    if (!Number.isFinite(v) || !Number.isFinite(n)) return sum
    return sum + v * n
  }, 0)
}

// How many physical pieces — "42 notes & coins", a sanity check that you
// typed what you actually hold.
export function pieceCount(denoms = {}) {
  return Object.values(denoms).reduce((sum, qty) => sum + (Number(qty) || 0), 0)
}

// The newest count for each stash, since only the latest one is current.
// Counts of the same stash on the same day: the last one written wins.
export function latestCounts(counts = [], country = 'JP') {
  const byStash = new Map()
  for (const c of counts) {
    if ((c.country || 'JP') !== country) continue
    const key = (c.stash || 'Wallet').trim()
    const prev = byStash.get(key)
    if (!prev || timeOf(c) > timeOf(prev)) byStash.set(key, c)
  }
  return [...byStash.values()].sort((a, b) => timeOf(b) - timeOf(a))
}

// What cash you hold, and whether the books still agree with it.
//
//   counted  — the sum of the newest count of every stash
//   expected — counted, moved by cash that came in or went out AFTER the most
//              recent count (older movements are already baked into it)
//   drift    — expected vs. what a fresh count would show; surfaced by
//              recountDrift once you type a new count
//
// Using the most recent count across all stashes as the single cutoff is what
// keeps backfilled records from double-deducting: anything dated before you
// last counted was already in your hand when you counted it.
export function cashPosition({
  counts = [],
  expenses = [],
  income = [],
  recharges = [],
  officeItems = [],
  passes = [],
  withdrawals = [],
  accountEntries = [],
  country = 'JP',
} = {}) {
  const current = latestCounts(counts, country)
  const counted = current.reduce((s, c) => s + countTotal(c.denoms), 0)
  const countedAt = current.length ? toDate(current[0].date) : null
  const since = current.length ? timeOf(current[0]) : -Infinity

  // Cash expenses in this country's currency — an INR cash buy can't come out
  // of the yen in your pocket.
  const spent = expenses
    .filter(
      (e) => e.paymentMethod === 'Cash' && (e.country || 'JP') === country && timeOf(e) > since
    )
    .reduce((s, e) => s + (e.amount || 0), 0)
  // Cash income in THIS currency — rupees handed to you can't swell the yen
  // in your pocket. Records written before income carried a country are yen.
  const received = income
    .filter((r) => r.account === 'Cash' && (r.country || 'JP') === country && timeOf(r) > since)
    .reduce((s, r) => s + (r.amount || 0), 0)
  // Loading a prepaid card with cash takes the notes out of your pocket.
  const loaded = recharges
    .filter((r) => r.paidFrom === 'Cash' && timeOf(r) > since)
    .reduce((s, r) => s + (r.amount || 0), 0)
  // Paying cash for something the office will repay: it's their money, but
  // it left YOUR wallet today. The repayment arrives later as income, so
  // counting only that side would make cash on hand drift upward forever.
  const fronted = officeItems
    .filter((i) => i.paidWith === 'Cash' && timeOf(i) > since)
    .reduce((s, i) => s + (i.amount || 0), 0)
  // A commuter pass or its card deposit paid in cash (JPY only).
  const passCash = country === 'JP' ? passSpentFrom(passes, 'Cash', since) : 0
  // Cash pulled out of a bank account (ATM/counter): the account goes down,
  // the notes in your pocket go up. Matched by currency — a yen withdrawal
  // can't top up rupee cash.
  const withdrawn = withdrawals
    .filter((w) => (w.country || 'JP') === country && timeOf(w) > since)
    .reduce((s, w) => s + (w.amount || 0), 0)
  // Hand-logged ➕/➖ on cash, in this currency: how rupee cash gets corrected
  // upward (income records are yen-only), and how any found-or-lost notes are
  // explained during a reconcile.
  const adjusted = accountEntries
    .filter(
      (a) => a.account === 'Cash' && (a.country || 'JP') === country && timeOf(a) > since
    )
    .reduce((s, a) => s + (a.direction === 'debit' ? -(a.amount || 0) : a.amount || 0), 0)

  const movement =
    withdrawn +
    adjusted +
    received -
    spent -
    (country === 'JP' ? loaded + fronted + passCash : 0)

  return {
    stashes: current.map((c) => ({
      id: c.id,
      stash: (c.stash || 'Wallet').trim(),
      total: countTotal(c.denoms),
      pieces: pieceCount(c.denoms),
      denoms: c.denoms || {},
      note: c.note || '',
      date: toDate(c.date),
    })),
    counted,
    countedAt,
    spent,
    received,
    loaded,
    fronted,
    passCash,
    withdrawn,
    adjusted,
    expected: counted + movement,
    hasCount: current.length > 0,
  }
}

// The accounting behind the "expected" number: every cash movement since the
// last count — what was spent (and where), what came in — newest first. The
// signed amounts sum to exactly (expected − counted), so this ledger always
// explains the drift between your last count and now.
export function cashLedger({
  counts = [],
  expenses = [],
  income = [],
  recharges = [],
  officeItems = [],
  passes = [],
  withdrawals = [],
  accountEntries = [],
  country = 'JP',
} = {}) {
  const current = latestCounts(counts, country)
  const since = current.length ? timeOf(current[0]) : -Infinity
  const isJP = country === 'JP'
  const at = (r) => toDate(r.date ?? r.startDate)
  const after = (r) => (at(r)?.getTime() || 0) > since
  const rows = []

  for (const e of expenses) {
    if (e.paymentMethod !== 'Cash' || (e.country || 'JP') !== country || !after(e)) continue
    rows.push({
      id: `e-${e.id}`,
      date: at(e),
      icon: '🧾',
      label: e.note?.trim() || e.category || 'Expense',
      place: e.store || '',
      amount: -(e.amount || 0),
    })
  }
  for (const r of income) {
      if (r.account !== 'Cash' || (r.country || 'JP') !== country || !after(r)) continue
      rows.push({ id: `i-${r.id}`, date: at(r), icon: '💰', label: r.source || 'Income', place: '', amount: r.amount || 0 })
    }
  for (const w of withdrawals) {
    if ((w.country || 'JP') !== country || !after(w)) continue
    rows.push({ id: `w-${w.id}`, date: at(w), icon: '🏧', label: `Withdrew from ${w.account || 'bank'}`, place: '', amount: w.amount || 0 })
  }
  for (const a of accountEntries) {
    if (a.account !== 'Cash' || (a.country || 'JP') !== country || !after(a)) continue
    const debit = a.direction === 'debit'
    rows.push({
      id: `ae-${a.id}`,
      date: at(a),
      icon: debit ? '➖' : '➕',
      label: a.reason?.trim() || (debit ? 'Cash out' : 'Cash in'),
      place: '',
      amount: debit ? -(a.amount || 0) : a.amount || 0,
    })
  }
  if (isJP)
    for (const r of recharges) {
      if (r.paidFrom !== 'Cash' || !after(r)) continue
      rows.push({ id: `r-${r.id}`, date: at(r), icon: '🔋', label: `Top-up to ${r.card || 'Pasmo'}`, place: '', amount: -(r.amount || 0) })
    }
  if (isJP)
    for (const i of officeItems) {
      if (i.paidWith !== 'Cash' || !after(i)) continue
      rows.push({ id: `o-${i.id}`, date: at(i), icon: '💼', label: `Fronted: ${i.item || 'office'}`, place: '', amount: -(i.amount || 0) })
    }
  if (isJP)
    for (const p of passes) {
      const out = passDeduction(p, 'Cash')
      if (out <= 0 || !after(p)) continue
      rows.push({ id: `p-${p.id}`, date: at(p), icon: '🎫', label: p.label || 'Commuter pass', place: '', amount: -out })
    }

  return rows.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
}

// When you recount a stash, the difference between what the app expected that
// stash to hold and what you actually found. Positive = you have more than the
// books say (unlogged income, a miscount); negative = money left unlogged.
export function recountDrift({ stash, denoms, position }) {
  const previous = position.stashes.find(
    (s) => s.stash.toLowerCase() === (stash || '').trim().toLowerCase()
  )
  if (!previous) return null
  // Movements since the last count aren't attributed to a single stash, so the
  // comparison is only meaningful for the stash you spend from — shown as a
  // hint, never as a correction the app applies on its own.
  return countTotal(denoms) - previous.total
}

// Breakdown rows for the UI: one per denomination actually held, biggest first.
export function denomRows(denoms = {}, country = 'JP') {
  return (DENOMINATIONS[country] || DENOMINATIONS.JP)
    .map((value) => ({ value, qty: Number(denoms[value]) || 0 }))
    .filter((r) => r.qty > 0)
    .map((r) => ({ ...r, subtotal: r.value * r.qty }))
}
