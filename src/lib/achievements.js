// Achievement catalog + evaluation. Earned achievements are persisted in the
// settings doc ({ achievements: { [id]: isoDate } }) so they never need
// re-deriving from full history.
export const ACHIEVEMENTS = [
  { id: 'first-log', icon: '🌱', title: 'First entry', desc: 'Log your very first record' },
  { id: 'streak-7', icon: '🔥', title: 'One week strong', desc: '7-day logging streak' },
  { id: 'streak-30', icon: '⚡', title: 'Habit formed', desc: '30-day logging streak' },
  { id: 'streak-100', icon: '🏆', title: 'Centurion', desc: '100-day logging streak' },
  { id: 'saver-30', icon: '📈', title: 'Super saver', desc: 'Kept 30%+ of income in a month' },
  { id: 'budget-master', icon: '🎯', title: 'Budget master', desc: 'Stayed under every budget for a month' },
  { id: 'family-first', icon: '💝', title: 'Family first', desc: 'Sent ¥100,000+ home in a month' },
  { id: 'millionaire', icon: '💎', title: 'First million', desc: 'Saved ¥1,000,000 all-time' },
]

// Returns the ids earned given the current context. Null/undefined context
// fields simply can't unlock their achievement (e.g. allTimeSaved when the
// all-time listeners aren't active).
export function evaluateAchievements({
  recordCount = 0,
  streak = 0,
  bestMonthSavingsRate = null,
  budgetsRespectedLastMonth = false,
  maxMonthlySent = 0,
  allTimeSaved = null,
} = {}) {
  const earned = []
  if (recordCount > 0) earned.push('first-log')
  if (streak >= 7) earned.push('streak-7')
  if (streak >= 30) earned.push('streak-30')
  if (streak >= 100) earned.push('streak-100')
  if (Number.isFinite(bestMonthSavingsRate) && bestMonthSavingsRate >= 0.3) earned.push('saver-30')
  if (budgetsRespectedLastMonth) earned.push('budget-master')
  if (maxMonthlySent >= 100000) earned.push('family-first')
  if (Number.isFinite(allTimeSaved) && allTimeSaved >= 1_000_000) earned.push('millionaire')
  return earned
}
