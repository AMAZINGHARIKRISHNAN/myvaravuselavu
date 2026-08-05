import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { useSettings } from '../../hooks/useSettings'
import { defaultMonthOffset } from '../../lib/planning'
import { monthRange } from '../../lib/dateRanges'

// Salary day turns the review into an event: from the day the money lands
// until you tick it off, the Dashboard leads with an invitation to sit down
// with the month. Once marked reviewed, it stays gone until the next one.
export default function ReviewBanner() {
  const { settings, loading } = useSettings()
  if (loading) return null

  const salaryDate = settings?.salaryDate || 25
  const today = new Date()
  const due = today.getDate() >= salaryDate
  if (!due) return null

  const { key, label } = monthRange(defaultMonthOffset(salaryDate, today))
  if (settings?.lastReviewedMonth === key) return null

  return (
    <Link
      to="/review"
      className="flex items-center gap-3 rounded-2xl border border-indigo-400/30 bg-gradient-to-r from-indigo-600 to-violet-600 p-4 text-white shadow-[0_10px_30px_rgba(79,70,229,0.35)] transition-transform active:scale-[0.99] touch-manipulation"
    >
      <span className="text-xl" aria-hidden="true">
        📋
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label} is ready to review</span>
        <span className="block text-xs text-white/75">
          Salary day ({format(today, 'd MMM')}) — see what you kept, made and can send home
        </span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-white/70" aria-hidden="true" />
    </Link>
  )
}
