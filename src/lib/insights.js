import { formatJPY } from './format'

function sumByCategory(expenses) {
  const totals = {}
  for (const e of expenses) {
    totals[e.category] = (totals[e.category] || 0) + (e.amount || 0)
  }
  return totals
}

// Returns up to 3 short insight strings comparing this month vs previous.
export function buildInsights({ expenses, prevExpenses, savingsRate, prevSavingsRate }) {
  const insights = []
  const thisTotals = sumByCategory(expenses)
  const prevTotals = sumByCategory(prevExpenses)

  // Top spending category this month
  const top = Object.entries(thisTotals).sort((a, b) => b[1] - a[1])[0]
  if (top && top[1] > 0) {
    insights.push({ icon: '🏆', text: `${top[0]} is your top spend at ${formatJPY(top[1])}` })
  }

  // Biggest category change vs last month
  let biggestChange = null
  for (const [cat, amount] of Object.entries(thisTotals)) {
    const prev = prevTotals[cat] || 0
    if (prev > 0 && amount > 0) {
      const change = (amount - prev) / prev
      if (Math.abs(change) >= 0.2 && (!biggestChange || Math.abs(change) > Math.abs(biggestChange.change))) {
        biggestChange = { cat, change }
      }
    }
  }
  if (biggestChange) {
    const pct = Math.abs(Math.round(biggestChange.change * 100))
    const up = biggestChange.change > 0
    insights.push({
      icon: up ? '📈' : '📉',
      text: `${biggestChange.cat} is ${up ? 'up' : 'down'} ${pct}% vs last month`,
    })
  }

  // Savings rate trend
  if (Number.isFinite(savingsRate) && Number.isFinite(prevSavingsRate)) {
    const diff = savingsRate - prevSavingsRate
    if (Math.abs(diff) >= 0.03) {
      const up = diff > 0
      insights.push({
        icon: up ? '🎉' : '⚠️',
        text: `You're saving ${up ? 'more' : 'less'} than last month (${up ? '+' : ''}${Math.round(diff * 100)}pts)`,
      })
    }
  }

  return insights.slice(0, 3)
}
