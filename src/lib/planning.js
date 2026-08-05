// Safe-to-spend: what's left per day after savings target, what's already
// spent/sent, and recurring items still due this month.
export function computeSafeToSpend({
  expectedIncome,
  savingsTarget = 0,
  spent = 0,
  upcoming = 0,
  now = new Date(),
}) {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const daysLeft = daysInMonth - now.getDate() + 1
  const available = expectedIncome - savingsTarget - spent - upcoming
  return {
    daysLeft,
    available,
    perDay: available > 0 ? available / daysLeft : 0,
  }
}

// Which month the month-end review opens on: once salary day has passed, the
// month you're in is the one worth reviewing; before that, last month is the
// finished one. (0 = this month, 1 = last month — matches monthRange.)
export function defaultMonthOffset(salaryDate = 25, today = new Date()) {
  return today.getDate() >= salaryDate ? 0 : 1
}

// Month report grade from savings rate.
export function gradeForSavingsRate(rate) {
  if (!Number.isFinite(rate)) return null
  if (rate >= 0.4) return 'A'
  if (rate >= 0.25) return 'B'
  if (rate >= 0.1) return 'C'
  if (rate >= 0) return 'D'
  return 'E'
}
