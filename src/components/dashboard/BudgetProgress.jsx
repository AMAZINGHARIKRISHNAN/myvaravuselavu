import { formatJPY } from '../../lib/format'

function barColor(ratio) {
  if (ratio >= 1) return 'bg-red-500'
  if (ratio >= 0.7) return 'bg-amber-500'
  return 'bg-gradient-to-r from-indigo-500 to-fuchsia-500'
}

export default function BudgetProgress({ budgets, spendByCategory }) {
  const entries = Object.entries(budgets || {}).filter(([, cap]) => cap > 0)
  if (entries.length === 0) return null

  return (
    <div className="card p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Monthly budgets</h2>
      <div className="space-y-3">
        {entries.map(([category, cap]) => {
          const spent = spendByCategory[category] || 0
          const ratio = cap > 0 ? spent / cap : 0
          const pct = Math.min(ratio * 100, 100)
          return (
            <div key={category}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-gray-700 dark:text-gray-300">{category}</span>
                <span className="text-gray-400 dark:text-gray-500">
                  {formatJPY(spent)} / {formatJPY(cap)}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden dark:bg-neutral-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor(ratio)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {ratio >= 1 && (
                <p className="text-[11px] text-red-500 mt-1 dark:text-red-400">Over budget</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
