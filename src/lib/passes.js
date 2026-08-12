// Commuter passes: buy a month of travel for less than the daily fares would
// cost, then claim the office's per-day rate anyway.
//
// The office reimburses what a commute costs on paper — fare × days you came
// in. The pass costs a flat amount however much you travel. The gap between
// the two is real, recurring profit:
//
//   claimable = days you commuted in the pass window × the per-day fare
//   cost      = what the pass cost you
//   profit    = claimable − cost
//
// Days come from the trips you already log, so the number moves on its own as
// the month fills in — no second place to keep up to date. Personal outings
// (leg 'other') and trips marked not reimbursable never count: the office
// isn't paying for those.
import { toDate } from './format'
import { dateKey, isOtherTrip } from './commute'

const dayStart = (v) => {
  const d = toDate(v)
  if (!d) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Is this date inside the pass's validity? Both ends inclusive, compared by
// calendar day so a 7am trip on the last day still counts.
export function coversDate(pass, date) {
  const d = dayStart(date)
  const from = dayStart(pass?.startDate)
  const to = dayStart(pass?.endDate)
  if (!d || !from) return false
  if (d < from) return false
  if (to && d > to) return false
  return true
}

// The pass covering a given day, if any. While one is active that day's travel
// is already bought and paid for, so an individual trip must NOT also book its
// fare as spending — the yen left once, when the pass was purchased. The trip
// still gets logged either way: it's what the office reimburses.
export function passCovering(passes = [], date) {
  return passes.find((p) => coversDate(p, date)) ?? null
}

// One row per commuting day inside the window — both legs of a day are one
// day, not two, because the office reimburses a day's travel.
export function passDays(pass, trips = []) {
  const keys = new Set()
  for (const t of trips) {
    if (isOtherTrip(t)) continue // personal outing, not a commute
    if (t.reimbursable === false) continue
    const d = toDate(t.date)
    if (!d || !coversDate(pass, d)) continue
    keys.add(t.dateKey || dateKey(d))
  }
  return keys.size
}

// What the pass is doing for you, as of now.
//   fare — the office's per-day rate (both legs), from your commute settings
export function passResult(pass, trips = [], fare = 0) {
  const days = passDays(pass, trips)
  const perDay = pass?.dailyRate ?? fare ?? 0
  const claimable = days * perDay
  const cost = pass?.cost || 0
  return {
    days,
    perDay,
    claimable,
    cost,
    profit: claimable - cost,
    // How many days it takes to cover the pass — the point where every further
    // commute is pure gain.
    breakEvenDays: perDay > 0 ? Math.ceil(cost / perDay) : null,
    expired: pass?.endDate ? dayStart(pass.endDate) < dayStart(new Date()) : false,
  }
}

// What a pass took out of one money source (a bank account label, 'Cash', or a
// card name like 'Pasmo'). Two independent payments can hit two sources:
//   cost    — the pass/recharge itself, out of `paidFrom`
//   deposit — the refundable card deposit, out of `depositPaidFrom`, only while
//             you still hold the card. Hand it back (depositRefunded) and the
//             money returns, so the deduction disappears — net zero.
// Older passes with no source recorded move nothing, leaving history untouched.
export function passDeduction(pass, source) {
  let amount = 0
  if ((pass?.cost || 0) > 0 && pass?.paidFrom === source) amount += pass.cost
  if ((pass?.deposit || 0) > 0 && !pass?.depositRefunded && pass?.depositPaidFrom === source) {
    amount += pass.deposit
  }
  return amount
}

// Sum across passes of what left one source, respecting the reconcile cutoff
// (records dated before a "set exact balance" are already baked in).
// Inclusive on purpose — see the cutoff note in wallet.js/cardBalance: a pass
// and a reconcile both backdated to the same day share one timestamp, and the
// pass must still be counted.
export function passSpentFrom(passes = [], source, since = -Infinity) {
  return passes.reduce((total, p) => {
    const t = toDate(p?.date ?? p?.startDate)?.getTime() ?? 0
    return t >= since ? total + passDeduction(p, source) : total
  }, 0)
}

// Every pass, newest first, each with its live numbers attached.
export function passesWithResults(passes = [], trips = [], fare = 0) {
  return [...passes]
    .sort((a, b) => (toDate(b.startDate)?.getTime() || 0) - (toDate(a.startDate)?.getTime() || 0))
    .map((p) => ({ ...p, result: passResult(p, trips, fare) }))
}

// Total pass profit, counted only once a pass has actually been used. A pass
// bought today with no trips yet is a cost, not a loss — it just hasn't
// earned out. Passes still running are reported as "on the way" so the
// headline number stays money you've genuinely made.
export function passProfit(passes = [], trips = [], fare = 0, range = null, inRange = () => true) {
  const out = { realized: 0, pending: 0, realizedCount: 0, pendingCount: 0 }
  for (const pass of passes) {
    if (!inRange(pass.startDate, range)) continue
    const r = passResult(pass, trips, fare)
    if (r.days === 0) continue
    if (r.expired) {
      out.realized += r.profit
      out.realizedCount += 1
    } else {
      out.pending += r.profit
      out.pendingCount += 1
    }
  }
  return out
}
