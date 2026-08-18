// Shared friend-ledger math, used by both the Friends page and the
// Dashboard P/L card so the numbers can never disagree.

// An item is settled when the friend has given back at least what they owed,
// OR when it was explicitly closed (accepted as final even if they gave less —
// that shortfall then shows up as a loss instead of staying "open" forever).
export const isSettled = (p) => p.closed === true || (p.received || 0) >= (p.due || 0)

// Cash profit/loss on one item = money that came in minus money that went out.
// Covers both directions: friend owed 550 but gave 600 → +50 profit;
// your side cost 550 but you only paid 500 → +50 profit. Loss works the same.
export const cashPL = (p) => (p.received || 0) - (p.paid ?? p.cost ?? 0)

// Rolls settled items of one currency into profit/loss buckets with
// percentages. Percentage = gain (or loss) relative to the cash you put into
// those same items — i.e. "you made 9% on the money you fronted".
export function computePLBuckets(items) {
  const b = {
    profit: 0, profitBase: 0, // winners: total gain + cash-out behind them
    loss: 0, lossBase: 0, // losers: total loss + cash-out behind them
    settledCount: 0,
  }
  for (const p of items) {
    if (!isSettled(p)) continue
    b.settledCount += 1
    const pl = cashPL(p)
    const base = p.paid ?? p.cost ?? 0
    if (pl > 0) {
      b.profit += pl
      b.profitBase += base
    } else if (pl < 0) {
      b.loss += -pl
      b.lossBase += base
    }
  }
  b.net = b.profit - b.loss
  b.profitPct = b.profitBase > 0 ? b.profit / b.profitBase : 0
  b.lossPct = b.lossBase > 0 ? b.loss / b.lossBase : 0
  return b
}

// ---- Money that went out and was never recorded leaving ----------------------
//
// The friend ledger is one-sided, and this finds where.
//
// When a friend pays you back, the Friends page writes an accountEntries credit
// and your balance rises. When you lend or buy on their behalf, the same page
// writes only the friend row — it never had a "paid from" field, so nothing
// recorded the money leaving. Collect on one of those and your balance goes UP
// from money that never went DOWN.
//
// A row created from the entry sheet is fine: that path writes the expense and
// the friend row together and links them with expenseId. Its absence is the
// marker, and it is the only one used here — deliberately, so this costs no
// extra read. A row whose linked expense was later deleted is not detected;
// that is a narrower hole than the one being reported and it needs the whole
// expense collection to see.
export const isUnfunded = (p) => !p?.expenseId && (p?.paid ?? p?.cost ?? 0) > 0

// Every such row, with what they add up to per currency. Read-only: this
// reports, and changes nothing.
export function unfundedPurchases(purchases = []) {
  const rows = purchases.filter(isUnfunded)
  const byCountry = new Map()

  for (const p of rows) {
    const country = p.country || 'JP'
    const entry = byCountry.get(country) || { country, amount: 0, count: 0 }
    entry.amount += p.paid ?? p.cost ?? 0
    entry.count += 1
    byCountry.set(country, entry)
  }

  return {
    rows: rows
      .slice()
      .sort((a, b) => (b.paid ?? b.cost ?? 0) - (a.paid ?? a.cost ?? 0)),
    totals: [...byCountry.values()].sort((a, b) => b.amount - a.amount),
    count: rows.length,
  }
}
