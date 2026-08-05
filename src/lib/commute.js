// Commute tracking: the daily home↔office bus runs and the reimbursement
// paperwork around them. Trips live in `commuteTrips`, claims (named bundles
// of trips waiting for the office to pay back) in `commuteClaims`.

export const COMMUTE_LEGS = [
  { key: 'toOffice', label: 'Bus to office', emoji: '🌅' },
  { key: 'toHome', label: 'Return home', emoji: '🌆' },
]

// Not everything is the office run: `leg: 'other'` is any personal outing
// (mall, station, weekend trip) with its own purpose text. It shares the
// calendar and expense mirroring but stays out of office claims by default.
export const OTHER_LEG = 'other'
export const isOtherTrip = (t) => t.leg === OTHER_LEG

// Emoji + label for any trip, commute leg or personal outing.
export function tripDisplay(trip) {
  if (isOtherTrip(trip)) return { emoji: '🧳', label: trip.purpose || 'Other trip' }
  const leg = COMMUTE_LEGS.find((l) => l.key === trip.leg) || COMMUTE_LEGS[0]
  return { emoji: leg.emoji, label: leg.label }
}

export const COMMUTE_METHODS = ['nimoca', 'Pasmo', 'Suica', 'Cash']

// Local YYYY-MM-DD key — commute days are calendar days in the user's zone,
// never UTC (a 7am JST bus must not count as yesterday).
export function dateKey(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const isWeekday = (d) => d.getDay() !== 0 && d.getDay() !== 6

// ---- Japanese public holidays: no office on a 祝日, so auto-log skips them.
// Computed instead of a table so it never goes stale: fixed dates,
// happy-Monday holidays, the two equinoxes (formula valid 2000–2099), and
// the substitute-Monday rule (holiday on Sunday → next weekday off).

const nthMondayDate = (year, month, n) => {
  const firstDay = new Date(year, month, 1).getDay()
  return 1 + ((8 - firstDay) % 7) + (n - 1) * 7
}
const equinox = (base, year) => Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))

export function jpHolidayKeys(year) {
  const dates = [
    [0, 1], // New Year's Day
    [0, nthMondayDate(year, 0, 2)], // Coming of Age Day
    [1, 11], // National Foundation Day
    [1, 23], // Emperor's Birthday
    [2, equinox(20.8431, year)], // Vernal Equinox
    [3, 29], // Showa Day
    [4, 3], // Constitution Day
    [4, 4], // Greenery Day
    [4, 5], // Children's Day
    [6, nthMondayDate(year, 6, 3)], // Marine Day
    [7, 11], // Mountain Day
    [8, nthMondayDate(year, 8, 3)], // Respect for the Aged Day
    [8, equinox(23.2488, year)], // Autumnal Equinox
    [9, nthMondayDate(year, 9, 2)], // Sports Day
    [10, 3], // Culture Day
    [10, 23], // Labor Thanksgiving Day
  ].map(([m, d]) => new Date(year, m, d, 12))

  const keys = new Set(dates.map(dateKey))
  for (const d of dates) {
    if (d.getDay() !== 0) continue
    const sub = new Date(d)
    do {
      sub.setDate(sub.getDate() + 1)
    } while (keys.has(dateKey(sub)))
    keys.add(dateKey(sub))
  }
  return keys
}

const holidayCache = new Map()
export function isJpHoliday(d) {
  const y = d.getFullYear()
  if (!holidayCache.has(y)) holidayCache.set(y, jpHolidayKeys(y))
  return holidayCache.get(y).has(dateKey(d))
}

// A day the office actually expects you: weekday and not a public holiday.
export const isWorkday = (d) => isWeekday(d) && !isJpHoliday(d)

// Which workdays still need auto-logged trips: every weekday-that-isn't-a-
// holiday after `lastGeneratedKey` up to (and including) today. First run
// (no marker) starts today. Capped to the most recent `cap` days so a long
// absence (vacation month) doesn't flood the ledger with bogus commutes.
export function missingCommuteDays(lastGeneratedKey, today = new Date(), cap = 15) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  // First run has no history to catch up on — today only, never back-fill.
  if (!lastGeneratedKey) return isWorkday(start) ? [start] : []

  const days = []
  const cursor = new Date(start)
  // Walk backwards collecting workdays until we hit the marker or the cap.
  while (days.length < cap) {
    if (dateKey(cursor) <= lastGeneratedKey) break
    if (isWorkday(cursor)) days.unshift(new Date(cursor))
    cursor.setDate(cursor.getDate() - 1)
  }
  return days
}

export const sumTrips = (trips) => trips.reduce((s, t) => s + (t.amount || 0), 0)

// A trip is locked once it's part of a claim — edit/delete would silently
// change a total the office may already be processing.
export const tripLocked = (trip) => Boolean(trip.claimId)

// ---- Claim lifecycle -------------------------------------------------------
//
// A claim walks three stages:
//   submitted — handed to the office, waiting on their decision
//   approved  — they approved an amount (which may differ from what you spent),
//               but the money hasn't landed yet
//   paid      — the money arrived: income booked (or absorbed into salary)
//
// Claims written before this flow existed only had 'pending' and 'approved',
// where "approved" already meant paid — so map those forward here instead of
// migrating documents.
// A claim walks four stages. 'draft' is a report you're still building on the
// Reimbursements page — nothing has been handed over yet.
export const CLAIM_STAGES = [
  { key: 'draft', label: 'Draft', icon: '📝', hint: 'not handed to the office yet' },
  { key: 'submitted', label: 'Submitted', icon: '📤', hint: 'waiting for the office' },
  { key: 'approved', label: 'Approved', icon: '✅', hint: 'money not received yet' },
  { key: 'paid', label: 'Money received', icon: '💰', hint: 'booked in your books' },
]

export function claimStage(claim) {
  const status = claim?.status
  if (status === 'paid') return 'paid'
  // Legacy: the old flow booked the income at approval time, so an approved
  // claim that already has payment details is really a paid one.
  if (status === 'approved') {
    return claim.incomeId || claim.receivedVia ? 'paid' : 'approved'
  }
  // Sent back by the office lands you back at draft — fix it and resubmit,
  // which is exactly what happens in real expense systems.
  if (status === 'draft' || status === 'rejected') return 'draft'
  return 'submitted' // covers 'pending' and anything unrecognised
}

// Sent back for changes: still a draft, but with something to fix.
export const claimRejected = (claim) => claim?.status === 'rejected'

export const stageIndex = (claim) => CLAIM_STAGES.findIndex((s) => s.key === claimStage(claim))

// What you actually spent on the claim. Snapshotted onto the claim when it's
// created so later screens don't need to re-read every trip and item.
export const claimSpent = (claim) => claim?.claimedAmount ?? null

// What the office agreed to pay. Falls back to the spend, which is what the
// old flow always assumed.
export function claimApproved(claim) {
  const spent = claimSpent(claim)
  const approved = claim?.approvedAmount
  return Number.isFinite(approved) ? approved : spent
}

// Approved minus spent: positive = profit (they paid more than the bus cost),
// negative = you're out of pocket. Null when the claim predates the snapshot.
export function claimDifference(claim) {
  const spent = claimSpent(claim)
  const approved = claimApproved(claim)
  if (!Number.isFinite(spent) || !Number.isFinite(approved)) return null
  return approved - spent
}
