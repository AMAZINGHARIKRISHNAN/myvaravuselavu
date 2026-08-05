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
