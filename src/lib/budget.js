// Monthly category budgets vs. what's been spent. Pure math so the Dashboard
// bar and any alerts read from one place.
import { formatJPY } from './format'

export const NEAR_THRESHOLD = 0.8 // "getting close" once 80% is spent

// One row per category with a budget: spent, cap, ratio, and how much is left
// (negative = overspent). Sorted worst-first so the tightest budgets lead.
export function budgetRows(budgets = {}, spendByCategory = {}) {
  return Object.entries(budgets)
    .filter(([, cap]) => cap > 0)
    .map(([category, cap]) => {
      const spent = spendByCategory[category] || 0
      const ratio = cap > 0 ? spent / cap : 0
      return {
        category,
        cap,
        spent,
        ratio,
        remaining: cap - spent, // < 0 when over
        state: ratio >= 1 ? 'over' : ratio >= NEAR_THRESHOLD ? 'near' : 'ok',
      }
    })
    .sort((a, b) => b.ratio - a.ratio)
}

// A one-line summary for the alert banner: which categories are over or close.
// Returns null when everything is comfortably within budget.
export function budgetAlert(budgets = {}, spendByCategory = {}) {
  const rows = budgetRows(budgets, spendByCategory)
  const over = rows.filter((r) => r.state === 'over')
  const near = rows.filter((r) => r.state === 'near')
  if (over.length === 0 && near.length === 0) return null

  if (over.length > 0) {
    const worst = over[0]
    const extra =
      over.length === 1 ? '' : ` +${over.length - 1} more`
    return {
      level: 'over',
      text: `${worst.category} is over budget by ${formatJPY(-worst.remaining)}${extra}`,
      count: over.length,
    }
  }
  const worst = near[0]
  return {
    level: 'near',
    text: `${worst.category} is close — ${formatJPY(worst.remaining)} left of ${formatJPY(worst.cap)}`,
    count: near.length,
  }
}
