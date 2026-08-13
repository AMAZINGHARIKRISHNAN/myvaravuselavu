// Every way money comes back to you for MORE than it cost, in one place.
//
// Five sources:
//   🤝 friend deals      — a friend pays back more than their share cost you
//   💼 reimbursements    — the office approves more than the items cost
//   🛍 shopping refunds  — a return refunds more real money than you paid,
//                          including "keep it, we'll refund you anyway"
//   🚌 commuter passes   — the office pays per day, the pass cost you less
//   ✨ windfalls         — one-offs: a cancelled card, a returned deposit
//
// Only realized money counts toward the total: a claim that's approved but not
// paid, a refund still on its way, or a pass still running is reported
// separately as "on the way" so the headline number is money you actually hold.
import { computePLBuckets, isSettled, cashPL } from './friendLedger'
import { claimDifference, claimStage } from './commute'
import { passProfit, passResult } from './passes'
import { splitWindfalls, windfallProfit, windfallKind } from './windfall'
import { splitLosses, lossAmount, lossKind } from './loss'
import { toDate } from './format'
import { countryOf } from './money'

// Optional {start, end} window. Every source dates its profit differently, so
// each one passes the field that says WHEN the money moved.
export function inRange(value, range) {
  if (!range) return true
  const date = toDate(value)
  if (!date) return false
  if (range.start && date < range.start) return false
  if (range.end && date > range.end) return false
  return true
}

// When a claim's money moved: paid date if it landed, else the approval date.
const claimMoneyDate = (claim) =>
  claim?.paidAt || claim?.approvedAt || claim?.date || null

// Reimbursement surplus, split by whether the money has actually arrived.
export function reimbursementProfit(claims = [], range = null) {
  const out = { realized: 0, pending: 0, realizedCount: 0, pendingCount: 0 }
  for (const claim of claims) {
    const diff = claimDifference(claim)
    if (diff === null || diff === 0) continue
    if (!inRange(claimMoneyDate(claim), range)) continue
    const stage = claimStage(claim)
    if (stage === 'paid') {
      out.realized += diff
      out.realizedCount += 1
    } else if (stage === 'approved') {
      out.pending += diff
      out.pendingCount += 1
    }
    // 'submitted' claims have no approved figure yet — nothing to count.
  }
  return out
}

// A return that gave back more real money than the order took. Points aren't
// money, so they never enter this — they're store credit, tracked separately.
//
// `keptItem` is the Shein/Temu case: they refund you but tell you to keep the
// product. You end up with your money back AND the goods, so the whole refund
// is gain — there's no cost to subtract, because nothing was given up.
export function shoppingRefundProfit(orders = [], range = null) {
  const out = { realized: 0, pending: 0, realizedCount: 0, pendingCount: 0 }
  for (const order of orders) {
    if (order.status !== 'returned') continue
    if (!inRange(order.date, range)) continue
    const surplus = order.keptItem
      ? order.refundMoney || 0
      : (order.refundMoney || 0) - (order.cashPaid || 0)
    if (surplus <= 0) continue
    if (order.refundStatus === 'pending') {
      out.pending += surplus
      out.pendingCount += 1
    } else {
      out.realized += surplus
      out.realizedCount += 1
    }
  }
  return out
}

// The same money as buildProfitSources, but one row per THING that happened
// instead of one row per category — the answer to "what actually made me this?"
//
// Every entry says what it was, when, and how much of it was gain. Anything
// not yet in your hands is flagged `pending` and shown apart, so the list can
// never imply you're holding money that hasn't arrived.
export function profitEvents({
  friendPurchases = [],
  claims = [],
  orders = [],
  passes = [],
  trips = [],
  windfalls = [],
  losses = [],
  fare = 0,
  range = null,
} = {}) {
  const events = []

  // A friend deal only lands once it's settled — before that, the "profit"
  // is just an unpaid debt.
  for (const p of friendPurchases) {
    if (!isSettled(p)) continue
    if (!inRange(p.date, range)) continue
    const pl = cashPL(p)
    if (pl === 0) continue
    events.push({
      id: `friend-${p.id}`,
      icon: '🤝',
      source: 'Friend deal',
      label: p.item || 'Purchase',
      detail: `${p.friend || 'Friend'} settled${pl < 0 ? ' below cost' : ' above cost'}`,
      amount: pl,
      date: toDate(p.date),
      country: p.country || 'JP',
      to: '/friends',
    })
  }

  for (const claim of claims) {
    const diff = claimDifference(claim)
    if (diff === null || diff === 0) continue
    if (!inRange(claimMoneyDate(claim), range)) continue
    const stage = claimStage(claim)
    if (stage !== 'paid' && stage !== 'approved') continue
    events.push({
      id: `claim-${claim.id}`,
      icon: '💼',
      source: 'Reimbursement',
      label: claim.name || 'Expense report',
      detail:
        diff < 0
          ? stage === 'paid'
            ? 'office paid less than it cost you'
            : 'approved below cost — you eat the difference'
          : stage === 'paid'
            ? 'office paid above what it cost you'
            : 'approved above cost — money not in yet',
      amount: diff,
      date: toDate(claimMoneyDate(claim)),
      pending: stage !== 'paid',
      to: '/reimbursements',
    })
  }

  for (const order of orders) {
    if (order.status !== 'returned') continue
    if (!inRange(order.date, range)) continue
    const surplus = order.keptItem
      ? order.refundMoney || 0
      : (order.refundMoney || 0) - (order.cashPaid || 0)
    if (surplus <= 0) continue
    events.push({
      id: `order-${order.id}`,
      icon: '🛍',
      source: 'Refund',
      label: order.item || 'Order',
      detail: order.keptItem
        ? `${order.store || 'Seller'} refunded and let you keep it`
        : `${order.store || 'Seller'} refunded more than it cost`,
      amount: surplus,
      date: toDate(order.date),
      pending: order.refundStatus === 'pending',
      to: '/shopping',
    })
  }

  for (const pass of passes) {
    if (!inRange(pass.startDate, range)) continue
    const r = passResult(pass, trips, fare)
    if (r.days === 0) continue
    events.push({
      id: `pass-${pass.id}`,
      icon: '🚌',
      source: 'Commuter pass',
      label: pass.label || 'Commuter pass',
      detail: `${r.days} day${r.days === 1 ? '' : 's'} × ${r.perDay} claimable vs ${r.cost} paid`,
      amount: r.profit,
      date: toDate(pass.startDate),
      pending: !r.expired, // still running, so the figure can still move
      to: '/commute',
    })
  }

  for (const w of windfalls) {
    if (!inRange(w.date, range)) continue
    const profit = windfallProfit(w)
    if (profit === 0) continue
    events.push({
      id: `windfall-${w.id}`,
      icon: windfallKind(w.kind).emoji,
      source: windfallKind(w.kind).label,
      label: w.label || 'One-off gain',
      detail: w.cost > 0 ? `got ${w.received}, ${w.cost} of it was yours` : `got ${w.received}`,
      amount: profit,
      date: toDate(w.date),
      pending: w.status === 'pending',
      to: '/profit',
    })
  }

  // Money out, carried as a negative so one list can hold both sides and still
  // add up to what you actually made.
  for (const l of losses) {
    if (!inRange(l.date, range)) continue
    const amount = lossAmount(l)
    if (amount === 0) continue
    events.push({
      id: `loss-${l.id}`,
      icon: lossKind(l.kind).emoji,
      source: lossKind(l.kind).label,
      label: l.label || 'Money lost',
      detail:
        l.recovered > 0
          ? `paid ${l.paid}, got ${l.recovered} back`
          : l.status === 'disputed'
            ? 'disputed — might still come back'
            : 'gone for good',
      amount: -amount,
      date: toDate(l.date),
      pending: l.status === 'disputed',
      to: '/profit',
    })
  }

  return events.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
}

// Split a signed event list into the two headlines the Profit page shows. Only
// money already in hand (or already gone) counts — anything still pending is
// reported apart, on both sides, so neither number promises something that
// hasn't happened. Rupee rows are left out of both: the two currencies never
// mix in this app.
export function splitGainLoss(events = []) {
  const out = { gains: [], losses: [], gained: 0, lost: 0, pendingGain: 0, pendingLoss: 0 }
  for (const e of events) {
    if (countryOf(e) === 'IN') continue
    if (e.amount > 0) {
      out.gains.push(e)
      if (e.pending) out.pendingGain += e.amount
      else out.gained += e.amount
    } else if (e.amount < 0) {
      out.losses.push(e)
      if (e.pending) out.pendingLoss += -e.amount
      else out.lost += -e.amount
    }
  }
  out.net = out.gained - out.lost
  return out
}

// The Dashboard block: one row per source that has something to say, plus the
// JPY total. INR friend deals are reported on their own row and deliberately
// left out of the yen total — the two currencies never mix in this app.
// `range` narrows everything to one period (the month-end review); omit it for
// the all-time Dashboard block. Friend deals are dated by the purchase, not by
// when the friend finally paid — that's the only date those records carry.
export function buildProfitSources({
  friendPurchases = [],
  claims = [],
  orders = [],
  passes = [],
  trips = [],
  windfalls = [],
  losses = [],
  fare = 0,
  range = null,
} = {}) {
  const sources = []
  const friendsInRange = friendPurchases.filter((p) => inRange(p.date, range))

  const jpFriends = computePLBuckets(friendsInRange.filter((p) => (p.country || 'JP') !== 'IN'))
  if (jpFriends.settledCount > 0 && jpFriends.net !== 0) {
    sources.push({
      key: 'friends',
      icon: '🤝',
      label: 'Friend deals',
      amount: jpFriends.net,
      country: 'JP',
      to: '/friends',
      detail: `${jpFriends.settledCount} settled deal${jpFriends.settledCount === 1 ? '' : 's'}`,
    })
  }

  const reimbursements = reimbursementProfit(claims, range)
  if (reimbursements.realized !== 0 || reimbursements.pending !== 0) {
    sources.push({
      key: 'reimbursements',
      icon: '💼',
      label: 'Reimbursement surplus',
      amount: reimbursements.realized,
      pending: reimbursements.pending,
      country: 'JP',
      to: '/reimbursements',
      detail:
        reimbursements.realizedCount > 0
          ? `${reimbursements.realizedCount} claim${reimbursements.realizedCount === 1 ? '' : 's'} paid above cost`
          : 'approved, waiting on the money',
    })
  }

  const refunds = shoppingRefundProfit(orders, range)
  if (refunds.realized !== 0 || refunds.pending !== 0) {
    sources.push({
      key: 'refunds',
      icon: '🛍',
      label: 'Refund surplus',
      amount: refunds.realized,
      pending: refunds.pending,
      country: 'JP',
      to: '/shopping',
      detail: `${refunds.realizedCount + refunds.pendingCount} return${
        refunds.realizedCount + refunds.pendingCount === 1 ? '' : 's'
      } paid back more than they cost`,
    })
  }

  // The pass pays for itself once you've commuted past break-even; every day
  // after that is money the office hands over that you never spent.
  const passes_ = passProfit(passes, trips, fare, range, inRange)
  if (passes_.realized !== 0 || passes_.pending !== 0) {
    sources.push({
      key: 'passes',
      icon: '🚌',
      label: 'Commuter pass',
      amount: passes_.realized,
      pending: passes_.pending,
      country: 'JP',
      to: '/commute',
      detail:
        passes_.pendingCount > 0
          ? `${passes_.pendingCount} pass${passes_.pendingCount === 1 ? '' : 'es'} still running`
          : `${passes_.realizedCount} pass${passes_.realizedCount === 1 ? '' : 'es'} beat the daily fares`,
    })
  }

  const oneOffs = splitWindfalls(windfalls, range, inRange)
  if (oneOffs.realized !== 0 || oneOffs.pending !== 0) {
    sources.push({
      key: 'windfalls',
      icon: '✨',
      label: 'One-off gains',
      amount: oneOffs.realized,
      pending: oneOffs.pending,
      country: 'JP',
      to: '/profit',
      detail: `${oneOffs.realizedCount + oneOffs.pendingCount} windfall${
        oneOffs.realizedCount + oneOffs.pendingCount === 1 ? '' : 's'
      }`,
    })
  }

  // Losses ride in the same list as a negative row, so the total below stays
  // what you actually came out with rather than gains-only optimism.
  const lost = splitLosses(losses, range, inRange)
  if (lost.realized !== 0 || lost.pending !== 0) {
    sources.push({
      key: 'losses',
      icon: '📉',
      label: 'Money lost',
      amount: -lost.realized,
      pending: -lost.pending,
      country: 'JP',
      to: '/profit',
      detail:
        lost.realizedCount > 0
          ? `${lost.realizedCount} loss${lost.realizedCount === 1 ? '' : 'es'} written off`
          : 'disputed — might still come back',
    })
  }

  const inFriends = computePLBuckets(friendsInRange.filter((p) => p.country === 'IN'))
  if (inFriends.settledCount > 0 && inFriends.net !== 0) {
    sources.push({
      key: 'friends-in',
      icon: '🇮🇳',
      label: 'Friend deals (INR)',
      amount: inFriends.net,
      country: 'IN',
      to: '/friends',
      detail: `${inFriends.settledCount} settled deal${inFriends.settledCount === 1 ? '' : 's'}`,
      excludeFromTotal: true, // different currency — never added to the yen total
    })
  }

  const total = sources
    .filter((s) => !s.excludeFromTotal)
    .reduce((sum, s) => sum + (s.amount || 0), 0)
  const pendingTotal = sources
    .filter((s) => !s.excludeFromTotal)
    .reduce((sum, s) => sum + (s.pending || 0), 0)

  return { sources, total, pendingTotal }
}
