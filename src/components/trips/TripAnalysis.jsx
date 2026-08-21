import { useMemo } from 'react'
import { CATEGORY_ICONS } from '../../lib/constants'
import { formatByCountry } from '../../lib/format'
import {
  busiestDay,
  categoryShares,
  topExpenses,
  tripByDay,
  tripByMethod,
  untaggedDuring,
} from '../../lib/tripAnalytics'

// What a trip actually looked like, rather than what it added up to.
//
// The summary above this answers "how much". This answers "where did it go":
// which day ran away with it, which two purchases were half of it, which card
// carried it — and, last, how much you spent during those dates that is NOT on
// the trip, because every figure here is only as good as what was tagged.
//
// Drawn with CSS rather than a chart library. The bars are proportions of one
// number, the widest is always full, and recharts is 417kB that this screen
// would otherwise have to load to draw eight rectangles.

const Bar = ({ share, tone = 'bg-indigo-500' }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200/70 dark:bg-white/10">
    <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(share * 100, 2)}%` }} />
  </div>
)

const Heading = ({ children }) => (
  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
    {children}
  </p>
)

export default function TripAnalysis({ trip, expenses, totals }) {
  const days = useMemo(() => tripByDay(expenses, trip), [expenses, trip])
  const methods = useMemo(() => tripByMethod(expenses, trip?.id), [expenses, trip?.id])
  const biggest = useMemo(() => topExpenses(expenses, trip?.id, { limit: 5 }), [expenses, trip?.id])
  const missing = useMemo(() => untaggedDuring(expenses, trip), [expenses, trip])

  // One currency's worth of everything, chosen by which the trip actually was.
  // A yen trip is not made clearer by rows of empty rupee columns.
  const country = (totals?.totals?.IN || 0) > (totals?.totals?.JP || 0) ? 'IN' : 'JP'
  const shares = useMemo(
    () => categoryShares(totals?.byCategory?.[country] || {}),
    [totals, country]
  )
  const peak = busiestDay(days, country)
  const dayMax = days.reduce((m, d) => Math.max(m, d[country] || 0), 0)
  const money = (v) => formatByCountry(v, country)

  if ((totals?.count || 0) === 0) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Nothing tagged to this trip yet — add spending below and the breakdown appears here.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {days.length > 0 && dayMax > 0 && (
        <div className="space-y-1.5">
          <Heading>Day by day</Heading>
          {days.map((d) => (
            <div key={d.time} className="flex items-center gap-2 text-[11px]">
              <span className="w-14 shrink-0 text-gray-500 dark:text-gray-400">
                {d.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
              <span className="min-w-0 flex-1">
                <Bar share={dayMax > 0 ? (d[country] || 0) / dayMax : 0} />
              </span>
              <span className="w-20 shrink-0 text-right tabular-nums text-gray-700 dark:text-gray-200">
                {d[country] > 0 ? money(d[country]) : '—'}
              </span>
            </div>
          ))}
          {peak && (
            <p className="pt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              Most went on{' '}
              <span className="font-semibold text-gray-700 dark:text-gray-200">
                {peak.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
              </span>{' '}
              · {money(peak[country])}
            </p>
          )}
        </div>
      )}

      {shares.length > 0 && (
        <div className="space-y-1.5">
          <Heading>What it went on</Heading>
          {shares.map((s) => (
            <div key={s.category} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-gray-700 dark:text-gray-200">
                  {CATEGORY_ICONS[s.category] || '📌'} {s.category}
                </span>
                <span className="tabular-nums text-gray-900 dark:text-gray-100">
                  {money(s.amount)}{' '}
                  <span className="text-gray-400 dark:text-gray-500">
                    {Math.round(s.share * 100)}%
                  </span>
                </span>
              </div>
              <Bar share={s.share} />
            </div>
          ))}
        </div>
      )}

      {biggest.length > 0 && (
        <div className="space-y-1">
          <Heading>Biggest single spends</Heading>
          {biggest.map((e) => (
            <div key={e.id} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">
                {CATEGORY_ICONS[e.category] || '📌'} {e.note?.trim() || e.store || e.category}
              </span>
              <span className="shrink-0 tabular-nums text-gray-900 dark:text-gray-100">
                {formatByCountry(e.amount, e.country || country)}
              </span>
            </div>
          ))}
        </div>
      )}

      {methods.length > 0 && (
        <div className="space-y-1">
          <Heading>Paid with</Heading>
          {methods.map((m) => (
            <div key={m.label} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-gray-700 dark:text-gray-200">{m.label}</span>
              <span className="tabular-nums text-gray-900 dark:text-gray-100">
                {[m.JP > 0 && formatByCountry(m.JP, 'JP'), m.IN > 0 && formatByCountry(m.IN, 'IN')]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Last, and deliberately plain. Every number above is only as good as
          what was tagged, and a trip missing half its purchases still shows a
          confident total. Rent and bills legitimately fall inside the dates, so
          this reports rather than judges. */}
      {missing.count > 0 && (
        <p className="rounded-xl bg-gray-100/80 p-2.5 text-[11px] text-gray-600 dark:bg-neutral-800/50 dark:text-gray-300">
          {missing.count} other expense{missing.count === 1 ? '' : 's'} in these dates{' '}
          {missing.count === 1 ? 'is' : 'are'} not on this trip —{' '}
          <span className="tabular-nums">
            {[missing.JP > 0 && formatByCountry(missing.JP, 'JP'), missing.IN > 0 && formatByCountry(missing.IN, 'IN')]
              .filter(Boolean)
              .join(' + ')}
          </span>
          . Some of that is rent and bills, which belong off it.
        </p>
      )}
    </div>
  )
}
