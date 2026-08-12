import { useEffect, useState } from 'react'

// A Date that is stable within a calendar day and changes when the day does.
//
// Every date range in this app is derived from `new Date()` inside a useMemo.
// Memoised on `[]` those ranges freeze at whatever day the page was first
// opened — fine for a tab you close, wrong for an installed PWA, which is how
// this one is used. Left on the home screen over a month boundary the Dashboard
// went on calling last month "this month" and querying its dates.
//
// Handing the value to the range helpers (rather than keeping it as a bare
// cache-busting dependency) is what makes those helpers honest: they take the
// clock instead of reaching for it, so a memo that depends on the day actually
// says so, and the ranges stay testable at any date.
//
// It refreshes on the two moments that matter: returning to the app — the usual
// way a phone PWA wakes up — and a timer for the next midnight, for the rarer
// case of watching the screen as the day turns.
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

export function useToday() {
  const [today, setToday] = useState(() => new Date())

  useEffect(() => {
    let timer
    // setTimeout is clamped by the browser and drifts when a tab is throttled,
    // so it is a nudge to re-check rather than the source of truth — the state
    // only moves when the calendar day has genuinely changed, which keeps the
    // Date identity stable and the memos below it from recomputing.
    const check = () => {
      setToday((current) => {
        const next = new Date()
        return dayKey(next) === dayKey(current) ? current : next
      })
      schedule()
    }
    const schedule = () => {
      clearTimeout(timer)
      const now = new Date()
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
      // Capped so a machine that sleeps for a week still re-checks on waking
      // rather than sitting on one enormous pending timeout.
      timer = setTimeout(check, Math.min(midnight - now, 60 * 60 * 1000))
    }

    schedule()
    document.addEventListener('visibilitychange', check)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  return today
}
