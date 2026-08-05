// Reconciling a source against reality.
//
// You type what the bank app (or your pocket) actually holds; the app already
// knows what it thinks you hold. The gap is `diff`:
//
//   diff < 0 — you have LESS than the books say: spending, withdrawals or fees
//              that never got logged
//   diff > 0 — you have MORE: money that came in without being logged
//
// Then the gap gets explained line by line — each line says what happened, on
// which day, and becomes a real record of its own kind (an expense, a cash
// withdrawal, a fee…). `remaining` counts down as lines are added, and whatever
// is left when you finish is booked as one "unexplained" record, so the balance
// ends up matching reality exactly either way.
const round2 = (n) => Math.round(n * 100) / 100

// Every way money can quietly leave or enter a source, and what each one
// becomes when written. `bankOnly` lines make no sense for cash (you can't
// withdraw cash out of cash), `cashOnly` is the reverse.
export const LINE_TYPES = [
  { key: 'spent', label: '💸 Spent it', sign: -1, needsCategory: true },
  { key: 'withdraw', label: '🏧 Took out as cash', sign: -1, bankOnly: true },
  { key: 'fee', label: '🏦 Fee / charge', sign: -1, bankOnly: true },
  { key: 'received', label: '💰 Income I forgot', sign: 1, jpBankOnly: true },
  { key: 'credit', label: '➕ Money in', sign: 1 },
]

// Which line types apply to this source: rupee accounts skip the income type
// (income is tracked in yen app-wide, so rupees would distort those totals —
// '➕ Money in' moves the balance without touching income), cash skips the
// bank-only ones, and a prepaid card can only be spent from or loaded.
export function typesFor({ isCash = false, isCard = false, country = 'JP' } = {}) {
  return LINE_TYPES.filter((t) => {
    if ((isCash || isCard) && t.bankOnly) return false
    if (t.jpBankOnly && (isCash || isCard || country !== 'JP')) return false
    return true
  })
}

export const lineSign = (type) => LINE_TYPES.find((t) => t.key === type)?.sign ?? -1

// What one line does to the balance, signed.
export function lineDelta(line) {
  const amount = parseFloat(line?.amount) || 0
  return lineSign(line?.type) * amount
}

// The gap this source still has to account for. Same sign convention as diff:
// negative means money is still missing, positive means unexplained surplus.
export function remaining(diff, lines = []) {
  return round2(lines.reduce((left, l) => left - lineDelta(l), diff))
}

export const isSettled = (diff, lines = []) => Math.abs(remaining(diff, lines)) < 0.005

// One line → one record, in whichever collection actually owns that kind of
// movement. Everything carries the source and its currency, so balances, cash
// on hand and the History feed all pick it up with no special cases.
export function lineOp(line, ctx) {
  const { account, country = 'JP', isCash = false, isCard = false } = ctx
  const amount = round2(parseFloat(line.amount) || 0)
  const date = line.date
  const what = (line.what || '').trim()
  const source = isCash ? 'Cash' : account

  // A prepaid card holds no account of its own: money onto it is a top-up
  // (with no paying source — this is money the card already had that the app
  // missed), and money off it is spending paid with the card.
  if (isCard && line.type === 'credit') {
    return {
      op: 'set',
      name: 'pasmoRecharges',
      data: {
        card: account,
        amount,
        setTo: null,
        paidFrom: null,
        date,
        note: what || 'Found while reconciling',
      },
    }
  }

  switch (line.type) {
    case 'withdraw':
      return {
        op: 'set',
        name: 'withdrawals',
        data: { account, amount, country, date, note: what || 'Found while reconciling' },
      }
    case 'fee':
      return {
        op: 'set',
        name: 'accountEntries',
        data: {
          direction: 'debit',
          account: source,
          amount,
          country,
          reason: what || 'Bank fee',
          date,
        },
      }
    case 'received':
      return {
        op: 'set',
        name: 'income',
        data: {
          amount,
          source: what || 'Money in',
          gross: null,
          net: null,
          account: source,
          country,
          note: 'Found while reconciling',
          date,
        },
      }
    case 'credit':
      return {
        op: 'set',
        name: 'accountEntries',
        data: {
          direction: 'credit',
          account: source,
          amount,
          country,
          reason: what || 'Money in',
          date,
        },
      }
    default:
      return {
        op: 'set',
        name: 'expenses',
        data: {
          amount,
          category: line.category || 'Other',
          country,
          paymentMethod: source,
          store: '',
          note: what || 'Found while reconciling',
          date,
        },
      }
  }
}

// Whatever couldn't be explained, as one record so the balance still lands on
// reality. Missing money becomes spending; a surplus becomes income for a yen
// account (it belongs in the income total) and a plain ➕ credit otherwise.
export function unexplainedOp(rest, ctx) {
  const { account, country = 'JP', isCash = false, isCard = false, date } = ctx
  const amount = round2(Math.abs(rest))
  const source = isCash ? 'Cash' : account
  const note = '❓ Unexplained (reconcile)'
  if (rest > 0 && isCard) {
    return {
      op: 'set',
      name: 'pasmoRecharges',
      data: { card: account, amount, setTo: null, paidFrom: null, date, note },
    }
  }
  if (rest < 0) {
    return {
      op: 'set',
      name: 'expenses',
      data: {
        amount,
        category: 'Other',
        country,
        paymentMethod: source,
        store: '',
        note,
        date,
      },
    }
  }
  if (!isCash && country === 'JP') {
    return {
      op: 'set',
      name: 'income',
      data: { amount, source: note, gross: null, net: null, account: source, country, note: '', date },
    }
  }
  return {
    op: 'set',
    name: 'accountEntries',
    data: { direction: 'credit', account: source, amount, country, reason: note, date },
  }
}

// Everything one source needs written, in one list: a record per line, plus the
// unexplained remainder when there is one. Zero-amount lines are dropped.
export function reconcileOps({ diff, lines = [], ctx }) {
  const real = lines.filter((l) => (parseFloat(l.amount) || 0) > 0)
  const ops = real.map((l) => lineOp(l, ctx))
  const rest = remaining(diff, real)
  if (Math.abs(rest) >= 0.005) ops.push(unexplainedOp(rest, ctx))
  return ops
}
