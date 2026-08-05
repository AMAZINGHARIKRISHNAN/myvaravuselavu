// Month-end audit: close the books. Add up everything, reconcile what the app
// thinks each balance is against what it actually is, log the bills that only
// you know (electricity, gas, water — combined some months, separate others),
// and record it all so the month is signed off and cross-checked.

// The bills that recur but vary — ticked per month, amounts typed in, because
// they're never quite the same. "Combined" covers the months the utility puts
// electricity and gas on one invoice.
export const COMMON_BILLS = [
  { key: 'rent', label: 'Rent', emoji: '🏠' },
  { key: 'electricity', label: 'Electricity', emoji: '⚡' },
  { key: 'gas', label: 'Gas', emoji: '🔥' },
  { key: 'elec_gas', label: 'Electricity + Gas (combined)', emoji: '⚡', combined: true },
  { key: 'water', label: 'Water', emoji: '💧' },
  { key: 'internet', label: 'Internet', emoji: '🌐' },
  { key: 'mobile', label: 'Mobile / phone', emoji: '📱' },
  { key: 'subscriptions', label: 'Subscriptions', emoji: '📺' },
]

export const billMeta = (key) => COMMON_BILLS.find((b) => b.key === key)

// Sum of the ticked bills that carry a real amount.
export function billsTotal(rows = []) {
  return rows
    .filter((r) => r.checked)
    .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
}

// The bills ready to be logged as expenses: ticked, positive amount.
export function billsToLog(rows = []) {
  return rows
    .filter((r) => r.checked && (parseFloat(r.amount) || 0) > 0)
    .map((r) => ({ label: r.label, amount: parseFloat(r.amount) || 0 }))
}

// Reconcile one balance: what the app computed vs. what you actually have.
//   diff > 0  → the app thinks you have MORE than reality: money left unlogged
//               (spending you forgot) — book it as an expense to true it up.
//   diff < 0  → you have MORE than the app knows: income never logged.
//   null      → nothing entered yet, so no comparison.
export function reconcileDiff(computed, actual) {
  if (actual === '' || actual === null || actual === undefined) return null
  const a = parseFloat(actual)
  if (!Number.isFinite(a)) return null
  return Math.round((computed - a) * 100) / 100
}

export const isReconciled = (diff) => diff !== null && Math.abs(diff) < 1

// The month's headline numbers, from records already scoped to the month.
export function monthTotals({ income = [], expenses = [], transfers = [] } = {}) {
  const totalIncome = income.reduce((s, r) => s + (r.amount || 0), 0)
  // JP-currency spend only for the "saved" line; INR expenses are a separate
  // currency and never netted against yen income.
  const totalExpenses = expenses
    .filter((e) => (e.country || 'JP') !== 'IN')
    .reduce((s, e) => s + (e.amount || 0), 0)
  const totalTransfers = transfers.reduce((s, t) => s + (t.amountSent || 0), 0)
  const saved = totalIncome - totalExpenses - totalTransfers
  return {
    income: totalIncome,
    expenses: totalExpenses,
    transfers: totalTransfers,
    saved,
    savingsRate: totalIncome ? saved / totalIncome : null,
  }
}
