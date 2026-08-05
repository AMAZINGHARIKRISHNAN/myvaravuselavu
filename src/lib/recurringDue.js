// When a monthly recurring item actually falls due.
//
// A bill set to "the 31st" is really "month end" — Docomo takes it on the 31st
// in July, the 30th in April and the 28th in February. So the target day is
// clamped to the length of the month being asked about, never to a fixed 28,
// which would have fired three days early in every 31-day month.
export const lastDayOfMonth = (ref = new Date()) =>
  new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate()

// The day of THIS month a "day N" item lands on.
export const dueDay = (day, ref = new Date()) =>
  Math.min(Math.max(parseInt(day, 10) || 1, 1), lastDayOfMonth(ref))

// The date to stamp on the posted record — the day the money really moves,
// not the day you happened to confirm it.
export const dateForDay = (day, ref = new Date()) =>
  new Date(ref.getFullYear(), ref.getMonth(), dueDay(day, ref))

// Has it come round yet this month? Both halves matter: the day has arrived,
// and this month's copy hasn't been posted already.
export const isDue = (r, ref = new Date(), monthKey = '') =>
  Boolean(r?.active) && r.lastGeneratedMonth !== monthKey && ref.getDate() >= dueDay(r.dayOfMonth, ref)
