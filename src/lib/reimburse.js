// Out-of-pocket money the office owes you back, tracked the way an expense
// system does it: individual EXPENSE LINES (what, when, how much, receipt),
// bundled into a REPORT you submit, which then walks
// draft → submitted → approved → paid.
//
// Storage reuses what the Commute page already writes, so nothing migrates:
//   officeReimbursements — the expense lines you add by hand
//   commuteTrips         — auto-logged bus runs, claimable the same way
//   commuteClaims        — the reports themselves (see CLAIM_STAGES)
import { toDate } from './format'
import { claimStage, claimSpent, claimApproved, claimDifference, dateKey } from './commute'

// Day bucket for a trip that predates the stored `dateKey`. Must be the LOCAL
// calendar day — toISOString() is UTC, which files a 7am JST bus under
// yesterday and splits one commute day across two report lines.
const tripDayKey = (t) => {
  const d = toDate(t.date)
  return t.dateKey || (d ? dateKey(d) : 'unknown')
}

// What kind of spend it was. Offices want this on every line — it's what
// decides which budget the money comes out of.
export const EXPENSE_TYPES = [
  { key: 'transport', label: 'Transport', emoji: '🚕' },
  { key: 'commute', label: 'Commute', emoji: '🚌' },
  { key: 'meals', label: 'Meals', emoji: '🍱' },
  { key: 'entertainment', label: 'Client entertainment', emoji: '🍻' },
  { key: 'supplies', label: 'Office supplies', emoji: '🖇️' },
  { key: 'equipment', label: 'Equipment', emoji: '🖥️' },
  { key: 'lodging', label: 'Hotel', emoji: '🏨' },
  { key: 'travel', label: 'Flight / Shinkansen', emoji: '✈️' },
  { key: 'training', label: 'Training / books', emoji: '📚' },
  { key: 'comms', label: 'Phone / internet', emoji: '📶' },
  { key: 'other', label: 'Other', emoji: '📌' },
]

export const typeMeta = (key) =>
  EXPENSE_TYPES.find((t) => t.key === key) || EXPENSE_TYPES[EXPENSE_TYPES.length - 1]

// Above this, a receipt photo is expected — the usual line in an expense
// policy, and the thing that gets reports sent back.
export const RECEIPT_REQUIRED_ABOVE = 3000

// How long the office gives you to file something before it's awkward.
export const STALE_AFTER_DAYS = 60

// Everything wrong with a line, checked before you submit rather than after
// the office sends it back.
export function itemIssues(item, today = new Date()) {
  const issues = []
  const amount = item?.amount || 0
  if (amount <= 0) issues.push({ key: 'amount', label: 'No amount' })
  if (!item?.receipt && amount > RECEIPT_REQUIRED_ABOVE) {
    issues.push({ key: 'receipt', label: 'Receipt needed' })
  }
  if (!item?.purpose?.trim() && !item?.note?.trim()) {
    issues.push({ key: 'purpose', label: 'No business purpose' })
  }
  const date = toDate(item?.date)
  if (date && (today - date) / 864e5 > STALE_AFTER_DAYS) {
    issues.push({ key: 'stale', label: `Over ${STALE_AFTER_DAYS} days old` })
  }
  return issues
}

// One shape for every claimable line, whether you typed it or the commute
// tracker logged it, so the list and the report math treat them alike.
export function itemLine(item) {
  return {
    id: item.id,
    kind: 'item',
    collection: 'officeReimbursements',
    date: toDate(item.date),
    type: item.type || 'other',
    title: item.item || typeMeta(item.type).label,
    vendor: item.vendor || '',
    amount: item.amount || 0,
    // What you asked the office for. Defaults to the real cost, so a line
    // where you claim exactly what you paid behaves as it always did.
    claimAmount: item.claimAmount ?? item.amount ?? 0,
    purpose: item.purpose || item.note || '',
    paidWith: item.paidWith || '',
    receipt: item.receipt || null,
    claimId: item.claimId || null,
    issues: itemIssues(item),
  }
}

// A day of commuting is one line: both legs, one fare total. Editing them
// stays on the Commute page — here they're only claimed.
export function commuteDayLine(dayKey, trips) {
  const amount = trips.reduce((s, t) => s + (t.amount || 0), 0)
  return {
    id: `commute-${dayKey}`,
    kind: 'commute',
    tripIds: trips.map((t) => t.id),
    date: toDate(trips[0]?.date),
    type: 'commute',
    title: `Commute · ${trips.length} trip${trips.length === 1 ? '' : 's'}`,
    vendor: trips[0]?.method || 'Pasmo',
    amount,
    claimAmount: amount, // the fare is the fare — nothing to mark up
    purpose: 'Daily office commute',
    paidWith: trips[0]?.method || '',
    receipt: null,
    claimId: trips[0]?.claimId || null,
    // Commute fares are a standing arrangement — no receipt expected.
    issues: [],
  }
}

// Every unclaimed line, newest first: typed expenses plus commute days.
export function claimableLines({ items = [], trips = [] } = {}) {
  const lines = items
    .filter((i) => !i.claimId && (i.status || 'open') !== 'received')
    .map(itemLine)

  const byDay = new Map()
  for (const t of trips) {
    if (t.claimId || t.reimbursable === false) continue
    const key = tripDayKey(t)
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(t)
  }
  for (const [key, dayTrips] of byDay) lines.push(commuteDayLine(key, dayTrips))

  return lines.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
}

export const sumLines = (lines) => lines.reduce((s, l) => s + (l.amount || 0), 0)

// What you're asking the office to pay, which can exceed what it cost you.
export const sumRequested = (lines) =>
  lines.reduce((s, l) => s + (l.claimAmount ?? l.amount ?? 0), 0)

// Per-line markup: ask ¥1,500 for a ¥1,200 item and ¥300 is profit if it's
// approved. Negative means you're claiming less than you spent.
export const lineMarkup = (line) => (line.claimAmount ?? line.amount ?? 0) - (line.amount || 0)

// The lines that belong to one report, same unified shape.
export function reportLines(claimId, { items = [], trips = [] } = {}) {
  const lines = items.filter((i) => i.claimId === claimId).map(itemLine)
  const byDay = new Map()
  for (const t of trips) {
    if (t.claimId !== claimId) continue
    const key = tripDayKey(t)
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(t)
  }
  for (const [key, dayTrips] of byDay) lines.push(commuteDayLine(key, dayTrips))
  return lines.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
}

// The four numbers that answer "where does my money stand with the office?"
//   toClaim   — spent, not yet on any report (your problem to file)
//   submitted — filed, no decision yet
//   approved  — agreed, money not in your hands
//   received  — actually paid back, plus how it compared to what you spent
export function reimbursementSummary({ items = [], trips = [], claims = [] } = {}) {
  const out = {
    toClaim: 0,
    toClaimCount: 0,
    draft: 0,
    submitted: 0,
    submittedCount: 0,
    approved: 0,
    approvedCount: 0,
    received: 0,
    receivedCount: 0,
    surplus: 0,
    issueCount: 0,
  }

  const open = claimableLines({ items, trips })
  out.toClaim = sumLines(open)
  out.toClaimCount = open.length
  out.issueCount = open.filter((l) => l.issues.length > 0).length

  for (const claim of claims) {
    const stage = claimStage(claim)
    const spent = claimSpent(claim) ?? 0
    if (stage === 'draft') {
      out.draft += spent
    } else if (stage === 'submitted') {
      out.submitted += spent
      out.submittedCount += 1
    } else if (stage === 'approved') {
      out.approved += claimApproved(claim) ?? spent
      out.approvedCount += 1
    } else if (stage === 'paid') {
      out.received += claimApproved(claim) ?? spent
      out.receivedCount += 1
      out.surplus += claimDifference(claim) || 0
    }
  }

  // Everything the office still owes you, whatever stage it's stuck at.
  out.outstanding = out.toClaim + out.draft + out.submitted + out.approved
  return out
}
