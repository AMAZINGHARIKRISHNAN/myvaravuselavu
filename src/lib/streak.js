import { toDate } from './format'

function dayKey(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Days from today until the next salary day (0 = today). Clamps the configured
// day to each month's length (salary day 31 pays on Feb 28).
export function daysUntilSalary(salaryDay, now = new Date()) {
  if (!salaryDay || salaryDay < 1) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const clamp = (y, m) => Math.min(salaryDay, new Date(y, m + 1, 0).getDate())
  let target = new Date(today.getFullYear(), today.getMonth(), clamp(today.getFullYear(), today.getMonth()))
  if (target < today) {
    const y = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear()
    const m = (today.getMonth() + 1) % 12
    target = new Date(y, m, clamp(y, m))
  }
  return Math.round((target - today) / 86_400_000)
}

// Totals for the last `n` days (oldest → newest), for sparklines.
export function lastNDaysTotals(records, n = 7, now = new Date()) {
  const totals = new Map()
  for (const r of records) {
    const d = toDate(r.date)
    if (!d) continue
    const key = dayKey(d)
    totals.set(key, (totals.get(key) || 0) + (r.amount || 0))
  }
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    out.push({ key: dayKey(d), value: totals.get(dayKey(d)) || 0 })
  }
  return out
}

export function todayTotal(records, now = new Date()) {
  const key = dayKey(now)
  let sum = 0
  for (const r of records) {
    const d = toDate(r.date)
    if (d && dayKey(d) === key) sum += r.amount || 0
  }
  return sum
}
