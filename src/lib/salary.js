// When the salary actually lands, and the payday check-in around it.
//
// Salary is paid on `salaryDate` (default the 25th). But if that day is a
// weekend or a Japanese public holiday, companies pay on the working day
// BEFORE it — so the prompt has to appear on the real credit date, which can
// be a day or two early, not on the 25th itself.
import { isWorkday } from './commute'

// The real credit date for a given month: the salary date, walked backwards to
// the previous working day if it lands on a weekend or holiday.
export function salaryPayDate(year, monthIndex, salaryDate = 25) {
  const d = new Date(year, monthIndex, salaryDate, 12)
  while (!isWorkday(d)) d.setDate(d.getDate() - 1)
  return d
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// Where this month's salary stands relative to today.
//   payDate — the holiday-adjusted credit date this month
//   monthKey — "YYYY-MM", used to remember it's been handled
//   due — today is on/after the credit date (time to ask)
export function salaryStatus(settings, today = new Date()) {
  const salaryDate = settings?.salaryDate || 25
  const payDate = salaryPayDate(today.getFullYear(), today.getMonth(), salaryDate)
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  return {
    payDate,
    monthKey,
    due: startOfDay(today).getTime() >= startOfDay(payDate).getTime(),
    alreadyLogged: settings?.salaryLoggedMonth === monthKey,
  }
}
