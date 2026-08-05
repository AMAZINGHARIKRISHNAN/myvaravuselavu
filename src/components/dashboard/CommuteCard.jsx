import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { formatJPY } from '../../lib/format'
import { dateKey } from '../../lib/commute'
import { cardBalance } from '../../lib/wallet'

// Dashboard shortcut to the commute tracker (it has no tab of its own):
// today's bus runs and the money left on the Pasmo card. Anything about
// claiming that money back lives in the Claims tab — this card deliberately
// says nothing about it, so there's exactly one place tracking what the
// office owes you.
export default function CommuteCard() {
  const trips = useCollection('commuteTrips')
  const recharges = useCollection('pasmoRecharges')
  // Balance needs ALL Pasmo-paid expenses, not just this month's.
  const expenses = useCollection('expenses')
  // Office purchases paid with Pasmo lighten the card too.
  const officeItems = useCollection('officeReimbursements')
  const passes = useCollection('commutePasses')

  const loggedToday = useMemo(() => {
    const today = dateKey(new Date())
    return trips.data.filter((t) => (t.dateKey || '') === today).length
  }, [trips.data])

  const pasmoBalance = useMemo(
    () => cardBalance('Pasmo', recharges.data, expenses.data, officeItems.data, passes.data),
    [recharges.data, expenses.data, officeItems.data, passes.data]
  )
  const hasPasmo = recharges.data.some((r) => (r.card || 'Pasmo') === 'Pasmo')
  const pasmoLow = pasmoBalance < 560 // less than one commute day left

  // Hide when there is genuinely nothing to say. It used to hide only while
  // loading, so a card reading "Nothing logged today" sat on the Dashboard
  // permanently — a card whose whole content is that nothing happened.
  // A low Pasmo balance still counts as something worth saying.
  if (trips.loading) return null
  if (loggedToday === 0 && !hasPasmo) return null

  return (
    <Link
      to="/commute"
      className="card flex items-center gap-3 p-4 transition-transform active:scale-[0.99] touch-manipulation"
    >
      <span className="text-xl" aria-hidden="true">
        🚌
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
          Commute
        </span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">
          {trips.data.length === 0
            ? 'Track your daily bus trips'
            : loggedToday > 0
              ? `${loggedToday} trip${loggedToday === 1 ? '' : 's'} logged today`
              : 'Nothing logged today'}
        </span>
        {hasPasmo && (
          <span
            className={`block text-xs font-semibold tabular-nums ${
              pasmoBalance < 0
                ? 'text-red-500 dark:text-red-400'
                : pasmoLow
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            💳 Pasmo {formatJPY(pasmoBalance)}
            {pasmoLow && pasmoBalance >= 0 && ' · recharge soon'}
          </span>
        )}
      </span>
      <ChevronRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
    </Link>
  )
}
