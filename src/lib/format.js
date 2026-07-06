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

// Formats a Date/Timestamp for <input type="date"> in LOCAL time.
// (toISOString() is UTC and shows the wrong day for morning JST times.)
export function toDateInputValue(value) {
  const d = value ? toDate(value) : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Parses an <input type="date"> value as a LOCAL date. If it's today, keeps the
// current time so same-day records sort in entry order; otherwise uses noon to
// stay clear of timezone edges.
export function parseDateInput(str) {
  const [y, m, d] = str.split('-').map(Number)
  const now = new Date()
  const isToday = now.getFullYear() === y && now.getMonth() === m - 1 && now.getDate() === d
  return isToday ? now : new Date(y, m - 1, d, 12)
}
