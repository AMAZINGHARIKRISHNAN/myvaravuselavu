import { Link } from 'react-router-dom'
import { Landmark, Pencil } from 'lucide-react'
import { useAccountBalances } from '../../hooks/useAccountBalances'
import { useLiveRate } from '../../hooks/useLiveRate'
import { formatByCountry, formatJPY } from '../../lib/format'
import Skeleton from '../ui/Skeleton'

const FLAGS = { JP: '🇯🇵', IN: '🇮🇳' }

// Running balance per bank account, derived from opening balance + your logs.
export default function AccountsCard() {
  const { balances, hasTracked, hasAccounts, loading } = useAccountBalances()
  const { rate: liveRate } = useLiveRate()

  if (!hasAccounts) return null

  if (!hasTracked) {
    return (
      <Link
        to="/settings"
        className="card flex items-center gap-3 p-4 transition-transform active:scale-[0.99] touch-manipulation"
      >
        <span className="icon-tile">
          <Landmark size={15} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
            Track your account balances
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Set each account's current balance in Settings — your logs keep it updated
          </span>
        </span>
      </Link>
    )
  }

  if (loading) return <Skeleton className="h-32 w-full" />

  // Approximate combined worth in JPY (INR accounts converted at the live rate).
  const jpyTotal = balances.reduce((sum, a) => {
    if (a.country !== 'IN') return sum + a.balance
    return liveRate ? sum + a.balance / liveRate : sum
  }, 0)
  const hasInr = balances.some((a) => a.country === 'IN')
  const showTotal = balances.length > 1 && (!hasInr || liveRate)

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <span className="icon-tile h-7 w-7">
            <Landmark size={13} aria-hidden="true" />
          </span>
          Accounts
        </h2>
        <Link
          to="/settings"
          aria-label="Edit accounts"
          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-indigo-600 dark:text-gray-500 dark:hover:text-indigo-400"
        >
          <Pencil size={13} />
        </Link>
      </div>

      <div className="space-y-2.5">
        {balances.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <span aria-hidden="true">{FLAGS[a.country] || '🏦'}</span>
              <span className="truncate font-medium">{a.label}</span>
            </span>
            <span
              className={`shrink-0 text-sm font-semibold tabular-nums ${
                a.balance < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {formatByCountry(a.balance, a.country)}
            </span>
          </div>
        ))}
      </div>

      {showTotal && (
        <p className="border-t border-gray-100 pt-2 text-[11px] text-gray-500 dark:border-white/5 dark:text-gray-400">
          ≈ {formatJPY(Math.round(jpyTotal))} combined{hasInr ? ' (at live rate)' : ''}
        </p>
      )}
    </div>
  )
}
