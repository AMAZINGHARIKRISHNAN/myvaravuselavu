import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useLiveRate } from '../../hooks/useLiveRate'

// Surfaces "good time to send money home" on the Dashboard when the live
// JPY→INR rate beats the user's own historical average by 1%+.
export default function RateBanner({ transfers }) {
  const { rate } = useLiveRate()

  const historical = transfers.map((t) => t.exchangeRate).filter((r) => r > 0)
  if (!rate || historical.length < 2) return null
  const avg = historical.reduce((sum, r) => sum + r, 0) / historical.length
  if (rate < avg * 1.01) return null

  return (
    <Link
      to="/transfers"
      className="card flex items-center gap-3 border-emerald-200 p-3.5 transition-transform active:scale-[0.99] touch-manipulation dark:border-emerald-500/25"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-base dark:bg-emerald-500/10">
        🟢
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
          Great JPY→INR rate: {rate.toFixed(3)}
        </span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">
          {(((rate - avg) / avg) * 100).toFixed(1)}% above your average — good day to send home
        </span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
    </Link>
  )
}
