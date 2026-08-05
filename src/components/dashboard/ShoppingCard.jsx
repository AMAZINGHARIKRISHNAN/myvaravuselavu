import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { useSettings } from '../../hooks/useSettings'
import { formatJPY, toDate } from '../../lib/format'

// Dashboard shortcut to the online-shopping tracker: this month's real-money
// spend (cash parts only, net of RECEIVED refunds) across Temu/Shein/Amazon,
// colored against the optional monthly cap, plus refunds still on the way.
export default function ShoppingCard() {
  const orders = useCollection('onlineOrders')
  const { settings } = useSettings()
  const budget = settings?.shoppingBudget || 0

  const { monthNet, count, pendingRefunds } = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    let net = 0
    let n = 0
    let pending = 0
    for (const o of orders.data) {
      if (o.status === 'returned' && o.refundStatus === 'pending') pending += o.refundMoney || 0
      const d = toDate(o.date)
      if (!d || d < monthStart) continue
      net += o.cashPaid || 0
      if (o.status === 'returned' && o.refundStatus !== 'pending') net -= o.refundMoney || 0
      n += 1
    }
    return { monthNet: net, count: n, pendingRefunds: pending }
  }, [orders.data])

  const overBudget = budget > 0 && monthNet > budget
  const nearBudget = budget > 0 && !overBudget && monthNet > budget * 0.8

  // No orders means no card. It used to hide only while loading, so a card
  // whose entire message was "Track Temu, Shein & Amazon orders" occupied the
  // Dashboard permanently — an advert for a feature rather than a readout.
  // The More sheet is where you go looking for it now.
  if (orders.loading) return null
  if (orders.data.length === 0) return null

  return (
    <Link
      to="/shopping"
      className="card flex items-center gap-3 p-4 transition-transform active:scale-[0.99] touch-manipulation"
    >
      <span className="text-xl" aria-hidden="true">
        🛍
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
          Online shopping
        </span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">
          {orders.data.length === 0
            ? 'Track Temu, Shein & Amazon orders, points and returns'
            : count === 0
              ? 'Nothing ordered this month'
              : `${count} order${count === 1 ? '' : 's'} this month${
                  overBudget ? ' · over the cap!' : nearBudget ? ' · nearing the cap' : ''
                }`}
        </span>
        {pendingRefunds > 0 && (
          <span className="block text-xs font-semibold text-amber-600 dark:text-amber-400">
            ⏳ {formatJPY(pendingRefunds)} refund on the way
          </span>
        )}
      </span>
      {monthNet > 0 && (
        <span
          className={`shrink-0 text-sm font-bold tabular-nums ${
            overBudget
              ? 'text-red-500 dark:text-red-400'
              : nearBudget
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-gray-900 dark:text-gray-100'
          }`}
        >
          {formatJPY(monthNet)}
        </span>
      )}
      <ChevronRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
    </Link>
  )
}
