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

// Month report grade from savings rate.
export function gradeForSavingsRate(rate) {
  if (!Number.isFinite(rate)) return null
  if (rate >= 0.4) return 'A'
  if (rate >= 0.25) return 'B'
  if (rate >= 0.1) return 'C'
  if (rate >= 0) return 'D'
  return 'E'
}
