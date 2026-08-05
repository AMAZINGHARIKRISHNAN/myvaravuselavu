// One-off money that came back to you for more than it cost — the gains that
// don't fit any of the regular flows.
//
// The classic: cancelling a Pasmo card and getting the deposit plus the
// remaining balance back in one lump. Whether that's *profit* depends on whose
// money was on the card — if the office had already reimbursed the commutes
// that loaded it, the payout is pure gain. Only you know that, so a windfall
// records BOTH numbers and lets you say:
//
//   received — what actually landed in your hand
//   cost     — what it really cost you (0 when none of it was your money)
//   profit   — the difference
//
// Nothing is assumed. A ¥56,000 payout with ¥0 cost is ¥56,000 of profit; the
// same payout against ¥56,000 of your own money is a wash, and says so.
import { toDate } from './format'

export const WINDFALL_KINDS = [
  // Nothing was yours to begin with, so the whole payout is gain — the cost box
  // stays out of the way for this one.
  { key: 'bonus', label: 'Work bonus', emoji: '🎉', hint: 'company bonus, incentive, allowance — enter what actually landed after tax', pureGain: true },
  { key: 'cardRefund', label: 'Card cancelled / refunded', emoji: '💳', hint: 'Pasmo, Suica, any prepaid card cashed out' },
  { key: 'deposit', label: 'Deposit returned', emoji: '🔑', hint: 'apartment, utility, rental deposit' },
  { key: 'cashback', label: 'Cashback / points cashed', emoji: '🎁', hint: 'card cashback, campaign payout' },
  { key: 'compensation', label: 'Compensation', emoji: '⚖️', hint: 'delay refund, goodwill payment, insurance' },
  { key: 'gift', label: 'Gift / prize', emoji: '🎉', hint: 'money you were given' },
  { key: 'other', label: 'Other', emoji: '✨', hint: '' },
]

export const windfallKind = (key) =>
  WINDFALL_KINDS.find((k) => k.key === key) || WINDFALL_KINDS[WINDFALL_KINDS.length - 1]

// What you actually gained. Cost is optional and defaults to nothing, because
// the common case (a deposit you'd written off, cashback, a prize) cost you
// nothing at all.
export const windfallProfit = (w) => (w?.received || 0) - (w?.cost || 0)

export const sumWindfalls = (list = []) => list.reduce((s, w) => s + windfallProfit(w), 0)

// Money in hand vs. money promised. A windfall you've been told about but
// haven't received yet shouldn't inflate what you can actually spend.
export function splitWindfalls(windfalls = [], range = null, inRange = () => true) {
  const out = { realized: 0, pending: 0, realizedCount: 0, pendingCount: 0 }
  for (const w of windfalls) {
    if (!inRange(w.date, range)) continue
    const profit = windfallProfit(w)
    if (profit === 0) continue
    if (w.received_ === false || w.status === 'pending') {
      out.pending += profit
      out.pendingCount += 1
    } else {
      out.realized += profit
      out.realizedCount += 1
    }
  }
  return out
}

// Sorted newest first for the list UI.
export const sortWindfalls = (list = []) =>
  [...list].sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))
