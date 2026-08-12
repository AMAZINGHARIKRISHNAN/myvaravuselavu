// Month-end audit: close the books. Add up everything, reconcile what the app
// thinks each balance is against what it actually is, log the bills that only
// you know (electricity, gas, water — combined some months, separate others),
// and record it all so the month is signed off and cross-checked.

// The bills that recur but vary — ticked per month, amounts typed in, because
// they're never quite the same. "Combined" covers the months the utility puts
// electricity and gas on one invoice.
import { countryOf } from './money'

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

// The month's headline numbers, from records already scoped to the month.
export function monthTotals({ income = [], expenses = [], transfers = [] } = {}) {
  // YEN ONLY, on BOTH sides. Spending was already filtered; income was not,
  // and income can genuinely be rupees — settling up in an Indian shared group
  // books income in that group's currency. A ₹4,000 settlement was landing in
  // this yen total as ¥4,000 and inflating the month's savings by the
  // difference. Records written before `country` existed are yen, which is why
  // the fallback is 'JP' on both sides.
  const totalIncome = income
    .filter((r) => (r.country || 'JP') !== 'IN')
    .reduce((s, r) => s + (r.amount || 0), 0)
  const totalExpenses = expenses
    .filter((e) => countryOf(e) !== 'IN')
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
