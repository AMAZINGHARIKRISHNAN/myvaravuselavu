import { format } from 'date-fns'
import { Flame, CalendarClock } from 'lucide-react'

function greetingFor(hour) {
  if (hour < 5) return 'Burning the midnight oil'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// Personal header: greeting + date, with habit chips (logging streak and
// salary countdown) that give a reason to open the app every day.
export default function GreetingHeader({ streak, salaryInDays }) {
  const now = new Date()

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
          {greetingFor(now.getHours())} 👋
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">{format(now, 'EEEE, d MMMM yyyy')}</p>
      </div>
      <div className="flex items-center gap-2">
        {streak > 1 && (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            <Flame size={13} aria-hidden="true" />
            {streak}-day streak
          </span>
        )}
        {salaryInDays !== null && (
          <span className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400">
            <CalendarClock size={13} aria-hidden="true" />
            {salaryInDays === 0 ? 'Salary today 🎉' : `Salary in ${salaryInDays}d`}
          </span>
        )}
      </div>
    </div>
  )
}
