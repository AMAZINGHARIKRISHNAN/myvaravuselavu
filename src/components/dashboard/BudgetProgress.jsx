import { formatJPY } from '../../lib/format'
import { budgetRows, budgetAlert } from '../../lib/budget'

function barColor(state) {
  if (state === 'over') return 'bg-red-500'
  if (state === 'near') return 'bg-amber-500'
  return 'bg-indigo-500'
}

export default function BudgetProgress({ budgets, spendByCategory }) {
  const rows = budgetRows(budgets, spendByCategory)
  if (rows.length === 0) return null

  const alert = budgetAlert(budgets, spendByCategory)

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Monthly budgets</h2>
        {alert && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              alert.level === 'over'
                ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            }`}
          >
            {alert.level === 'over' ? '⚠ Over' : '⏳ Close'}
          </span>
        )}
      </div>

      {/* One-line heads-up so a blown budget is obvious without reading bars */}
      {alert && (
        <p
          className={`text-xs ${
            alert.level === 'over'
              ? 'text-red-600 dark:text-red-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {alert.text}
        </p>
      )}

      <div className="space-y-3">
        {rows.map(({ category, cap, spent, ratio, remaining, state }) => (
          <div key={category}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-gray-700 dark:text-gray-300">{category}</span>
              <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                {formatJPY(spent)} / {formatJPY(cap)}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden dark:bg-neutral-800">
              <div
                className={`h-full rounded-full animate-[progress-fill_0.7s_ease-out] transition-all duration-500 ${barColor(state)}`}
                style={{ width: `${Math.min(ratio * 100, 100)}%` }}
              />
            </div>
            <p
              className={`mt-1 text-[11px] tabular-nums ${
                state === 'over'
                  ? 'text-red-500 dark:text-red-400'
                  : state === 'near'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {state === 'over'
                ? `Over by ${formatJPY(-remaining)}`
                : `${formatJPY(remaining)} left`}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
