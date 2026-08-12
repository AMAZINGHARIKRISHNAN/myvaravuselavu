// Moving your own money from one place to another.
//
// Not spending, not income — the total never changes, only where it sits. The
// app already had three separate versions of this idea (withdraw cash, top up
// a card, transfer to your own Indian account), each on a different screen and
// each writing to a different collection, plus two moves it could not do at
// all: bank → bank, and cash back INTO a bank.
//
// This is the one idea behind all of them: pick where it left, pick where it
// landed, say how much. What gets WRITTEN still depends on the pair, because
// the rest of the app already understands those shapes:
//
//   bank → card    pasmoRecharges  (a top-up; the card balance reads these)
//   bank → cash    withdrawals     (the Cash page already shows these by name)
//   anything else  a matched pair of accountEntries, one debit and one credit
//
// The pair is what makes bank → bank and cash → bank work with no changes to
// any balance code: useAccountBalances and cashPosition both already read
// accountEntries, so a debit on one side and a credit on the other moves
// exactly the two places involved and nothing else.
//
// CROSS-CURRENCY IS NOT HANDLED HERE. Yen to rupees is a remittance: it needs
// a rate, a fee and a record of what actually arrived, which is what the
// Transfers page exists for. Sending someone there is better than quietly
// inventing a rate.
import { PREPAID_CARDS } from './wallet'

export const CASH = 'Cash'

// Everywhere money can sit, as a flat list the UI can offer.
// `key` is unique (Cash exists in two currencies); `label` is what gets stored.
export function moneyPlaces(accounts = [], { includeCards = true } = {}) {
  const places = accounts.map((a) => ({
    key: `account:${a.label}`,
    label: a.label,
    country: a.country || 'JP',
    kind: 'account',
  }))

  // Cash is the one place that holds two currencies, and they are genuinely
  // separate piles — yen in your pocket in Japan, rupees in your pocket in
  // India. A move between them would be a currency exchange, not a move.
  places.push({ key: 'cash:JP', label: CASH, country: 'JP', kind: 'cash' })
  if (accounts.some((a) => a.country === 'IN')) {
    places.push({ key: 'cash:IN', label: CASH, country: 'IN', kind: 'cash' })
  }

  if (includeCards) {
    for (const card of PREPAID_CARDS) {
      // Company cards are loaded by the employer — you cannot put money on one.
      if (card.company) continue
      places.push({
        key: `card:${card.name}`,
        label: card.name,
        country: 'JP',
        kind: 'card',
        emoji: card.emoji,
      })
    }
  }
  return places
}

export const findPlace = (places, key) => places.find((p) => p.key === key) || null

// Can this move be recorded here, and if not, why?
//
// Returns { ok } or { ok: false, reason, remittance? }. `remittance` marks the
// one refusal that is really a redirect: yen to rupees belongs on Transfers.
export function checkMove(from, to, amount) {
  if (!from || !to) return { ok: false, reason: 'Pick where the money left and where it landed.' }
  if (from.key === to.key) return { ok: false, reason: 'Those are the same place.' }
  if (!(amount > 0)) return { ok: false, reason: 'Enter how much moved.' }

  if (from.country !== to.country) {
    return {
      ok: false,
      remittance: true,
      reason:
        'That changes currency, so it needs an exchange rate and what actually arrived — record it on the Transfers page.',
    }
  }
  if (to.kind === 'card' && from.kind === 'card') {
    return { ok: false, reason: 'Money cannot move straight from one prepaid card to another.' }
  }
  return { ok: true }
}

// What a move should write.
//
// Every branch produces ops for commitOps, so both sides of a move land in one
// commit or neither does — a half-recorded move would invent or destroy money,
// which is the one thing a ledger must never do.
export function moveOps({ from, to, amount, fee = 0, date, note = '' }) {
  const ops = []
  const why = note.trim()
  const country = from.country

  // Loading a prepaid card: the card's balance is built from these, so a
  // top-up has to be one of them rather than a generic credit.
  if (to.kind === 'card') {
    ops.push({
      op: 'set',
      name: 'pasmoRecharges',
      data: {
        card: to.label,
        amount,
        setTo: null,
        paidFrom: from.label,
        date,
        note: why,
      },
    })
  } else if (from.kind === 'account' && to.kind === 'cash') {
    // Taking cash out. `withdrawals` already moves both sides on its own —
    // the account down, the notes in your pocket up — so a second entry would
    // count it twice.
    ops.push({
      op: 'set',
      name: 'withdrawals',
      data: { account: from.label, amount, country, date, note: why },
    })
  } else {
    // The general case: one debit, one credit, same amount, same day.
    //
    // Both carry the same `moveId`, plus where the money went and came from.
    // Without that they are two unrelated rows in the History feed — "Debited
    // 8,335.25" here and "Credited 8,335.25" there — and a move you made once
    // reads as two things that happened to you.
    const moveId = `mv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const shared = { moveId, moveFrom: from.label, moveTo: to.label, amount, country, date }
    ops.push({
      op: 'set',
      name: 'accountEntries',
      data: {
        ...shared,
        direction: 'debit',
        account: from.label,
        reason: why || `Moved to ${to.label}`,
      },
    })
    ops.push({
      op: 'set',
      name: 'accountEntries',
      data: {
        ...shared,
        direction: 'credit',
        account: to.label,
        reason: why || `Moved from ${from.label}`,
      },
    })
  }

  // A bank's 振込手数料 is real money gone — not part of what landed, and not
  // spending on anything either. It comes off the sending side as its own
  // entry so the two balances still add up.
  if (fee > 0) {
    ops.push({
      op: 'set',
      name: 'accountEntries',
      data: {
        direction: 'debit',
        account: from.label,
        amount: fee,
        country,
        reason: `Transfer fee · ${from.label} → ${to.label}`,
        date,
      },
    })
  }

  return ops
}

// One line describing what will happen, shown before it is written. Saying it
// in words is what stops a move being logged the wrong way round.
export function describeMove({ from, to, amount, fee = 0 }, format) {
  if (!from || !to || !(amount > 0)) return ''
  const out = format(amount + (fee > 0 ? fee : 0), from.country)
  const inn = format(amount, to.country)
  const feeNote = fee > 0 ? ` (including a ${format(fee, from.country)} fee)` : ''
  return `${from.label} goes down by ${out}${feeNote} · ${to.label} goes up by ${inn}.`
}
