import { motion, useReducedMotion } from 'framer-motion'
import { useTheme } from '../../context/ThemeContext'
import { formatJPY, formatPercent } from '../../lib/format'
import ArcReactor from './ArcReactor'

// The Dashboard's headline panel, HUD build: the month's net savings sitting
// inside the reactor, with the same supporting figures the Classic hero shows.
//
// It takes those figures as props and its buttons as a node — Dashboard passes
// down the very same <ShareSummaryButton/>, <ImageReportButton/> and Review
// link it already renders. Nothing about what this screen *does* is duplicated
// here; only how it looks.
export default function HudHero({
  netSavings,
  savingsRate,
  spentToday,
  last7,
  safeToSpend,
  forecastExpenses,
  isCurrentMonth,
  actions,
}) {
  const { skin } = useTheme()
  const quiet = useReducedMotion()
  const last7Max = Math.max(...last7.map((d) => d.value), 1)

  // Panels assemble rather than appear. Staggered so the reactor lands first
  // and the readouts settle in around it.
  const panel = {
    hidden: { opacity: 0, y: quiet ? 0 : 10 },
    show: (i = 0) => ({
      opacity: 1,
      y: 0,
      transition: { duration: quiet ? 0 : 0.4, delay: quiet ? 0 : 0.06 * i, ease: [0.16, 1, 0.3, 1] },
    }),
  }

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={panel}
      className="card overflow-hidden p-5"
    >
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
        <ArcReactor skin={skin} pct={savingsRate} size={190}>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-indigo-400/80">
            Net saved
          </span>
          <span className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {formatJPY(Math.round(netSavings))}
          </span>
          <span className="mt-0.5 font-mono text-[10px] text-indigo-400/80">
            {formatPercent(savingsRate)} kept
          </span>
        </ArcReactor>

        <div className="min-w-0 flex-1 space-y-3 self-stretch">
          {isCurrentMonth && (
            <motion.div variants={panel} custom={1} className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                  Spent today
                </p>
                <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                  {formatJPY(spentToday)}
                </p>
              </div>
              <div className="flex h-10 items-end gap-1" aria-label="Spending, last 7 days">
                {last7.map((d, i) => (
                  <div
                    key={d.key}
                    className={`w-2.5 origin-bottom rounded-sm animate-[bar-rise_0.5s_ease-out] ${
                      i === last7.length - 1 ? 'bg-indigo-400' : 'bg-indigo-400/30'
                    }`}
                    style={{ height: `${Math.max(12, (d.value / last7Max) * 100)}%` }}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {safeToSpend && (
            <motion.div
              variants={panel}
              custom={2}
              className={`rounded-md border px-3 py-2.5 ${
                safeToSpend.available >= 0
                  ? 'border-indigo-500/30 bg-indigo-500/5'
                  : 'border-red-500/50 bg-red-500/10'
              }`}
            >
              {safeToSpend.available >= 0 ? (
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  Safe to spend{' '}
                  <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                    {formatJPY(Math.round(safeToSpend.perDay))}
                  </span>
                  /day · {safeToSpend.daysLeft} day{safeToSpend.daysLeft === 1 ? '' : 's'} left
                </p>
              ) : (
                <p className="text-xs text-red-500 dark:text-red-300">
                  Over plan by{' '}
                  <span className="font-bold tabular-nums">
                    {formatJPY(Math.abs(Math.round(safeToSpend.available)))}
                  </span>{' '}
                  — ease up to protect your savings target
                </p>
              )}
            </motion.div>
          )}

          {forecastExpenses !== null && (
            <p className="border-t border-indigo-500/15 pt-2 font-mono text-[11px] text-gray-500 dark:text-gray-400">
              Projection · {formatJPY(forecastExpenses)} by month end
            </p>
          )}

          {/* A dark control strip under the actions. The share/report buttons
              are styled for the Classic hero's gradient (white-on-translucent)
              and are shared verbatim with it — giving them a surface to sit on
              keeps them legible on frosted glass without forking them. */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-indigo-500/25 bg-neutral-950/75 p-2">
            {actions}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
