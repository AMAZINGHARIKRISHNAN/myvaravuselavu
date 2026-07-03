export function formatJPY(amount) {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount || 0)
}

export function formatINR(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount || 0)
}

// Expenses logged with country 'IN' are entered in INR, everything else in JPY.
export function formatByCountry(amount, country) {
  return country === 'IN' ? formatINR(amount) : formatJPY(amount)
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

export function toDate(value) {
  if (!value) return null
  if (value.toDate) return value.toDate()
  return new Date(value)
}
