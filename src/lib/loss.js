// The other side of the Profit page: money that left you and is never coming
// back. Deliberately a mirror of windfall.js, because the question is the same
// one asked backwards —
//
//   paid      — what actually went out
//   recovered — how much of it you got back (0 when none of it came back)
//   loss      — the difference, and the only figure that counts
//
// A ¥2,946 trip the office only reimburses ¥2,610 of is a ¥336 loss, not a
// ¥2,946 one. That gap is what this records. Losses that are already derived
// from something the app tracks — a claim approved below cost, a friend who
// settled short, a pass that never broke even — are computed in profit.js and
// must NOT be logged here as well, or they'd count twice.
import { toDate } from './format'

export const LOSS_KINDS = [
  { key: 'unreimbursed', label: 'Not reimbursed', emoji: '🧾', hint: 'you paid for work and the office only covered part of it, or none' },
  { key: 'fee', label: 'Fee charged', emoji: '🏦', hint: 'bank, ATM, transfer, card or service fee' },
  { key: 'penalty', label: 'Fine / penalty', emoji: '⚖️', hint: 'traffic fine, late fee, tax penalty' },
  { key: 'cancellation', label: 'Cancelled / forfeited', emoji: '🚫', hint: 'a booking you paid for and could not use' },
  // Money you did not earn is money you are out, and it is the one cost of a
  // trip that never appears as an expense: nothing leaves an account, so
  // nothing is logged, and the journey looks cheaper than it was.
  { key: 'unpaidLeave', label: 'Unpaid leave', emoji: '📅', hint: 'a day off work you were not paid for — the pay you gave up' },
  { key: 'lost', label: 'Lost or stolen', emoji: '💸', hint: 'cash, a card balance, anything gone' },
  { key: 'damage', label: 'Damage / repair', emoji: '🔧', hint: 'something broke and you paid for it' },
  { key: 'other', label: 'Other', emoji: '📉', hint: '' },
]

export const lossKind = (key) =>
  LOSS_KINDS.find((k) => k.key === key) || LOSS_KINDS[LOSS_KINDS.length - 1]

// What you're actually out. Never negative: recovering more than you paid is a
// gain, and gains belong on the profit side — logging one here as a negative
// loss would quietly inflate the profit headline from the wrong direction.
export const lossAmount = (l) => Math.max(0, (l?.paid || 0) - (l?.recovered || 0))


// Settled vs. still open. A loss you're disputing — a fee you've asked to have
// waived, a claim you're appealing — shouldn't be written off until it is.
export function splitLosses(losses = [], range = null, inRange = () => true) {
  const out = { realized: 0, pending: 0, realizedCount: 0, pendingCount: 0 }
  for (const l of losses) {
    if (!inRange(l.date, range)) continue
    const amount = lossAmount(l)
    if (amount === 0) continue
    if (l.status === 'disputed') {
      out.pending += amount
      out.pendingCount += 1
    } else {
      out.realized += amount
      out.realizedCount += 1
    }
  }
  return out
}

export const sortLosses = (list = []) =>
  [...list].sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))
