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

// Midnight of whatever day a value falls on, in LOCAL time. Reconcile points
// live at the start of their day: an anchor stamped at 23:50 would otherwise
// skip everything logged earlier that same day, and a record dated "12:00 AM"
// would land before an anchor set at noon.
export function startOfDay(value) {
  const d = value ? toDate(value) : new Date()
  if (!d || Number.isNaN(d.getTime())) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
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

// Formats a Date/Timestamp for <input type="datetime-local"> in LOCAL time
// ("YYYY-MM-DDTHH:mm"). Used where the exact moment matters — a remittance you
// want to match against the Wise confirmation, say — not just the day.
export function toDateTimeInputValue(value) {
  const d = value ? toDate(value) : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Parses a datetime-local value ("YYYY-MM-DDTHH:mm") as a LOCAL Date. Falls
// back to the date-only parser if no time part is present.
export function parseDateTimeInput(str) {
  if (!str) return new Date()
  const [datePart, timePart] = str.split('T')
  if (!timePart) return parseDateInput(datePart)
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0)
}
