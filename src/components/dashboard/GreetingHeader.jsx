import { format } from 'date-fns'
import { CalendarClock } from 'lucide-react'

function greetingFor(hour) {
  if (hour < 5) return 'Burning the midnight oil'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// Personal header: greeting, today's date, and how long until payday.
export default function GreetingHeader({ salaryInDays }) {
  const now = new Date()

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white">
          {greetingFor(now.getHours())} 👋
        </h2>
        <p className="text-xs text-gray-400">{format(now, 'EEEE, d MMMM yyyy')}</p>
      </div>
      {salaryInDays !== null && (
        <span className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400">
          <CalendarClock size={13} aria-hidden="true" />
          {salaryInDays === 0 ? 'Salary today 🎉' : `Salary in ${salaryInDays}d`}
        </span>
      )}
    </div>
  )
}
