import { useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { useRecurring } from '../../hooks/useRecurring'
import { useCollection } from '../../hooks/useCollection'
import { useToast } from '../../context/ToastContext'
import { fetchLiveJpyInrRate } from '../../lib/exchangeRate'
import { formatJPY } from '../../lib/format'

// Clamp a target day to the current month's length, return a Date in this month.
function dateForDay(day) {
  const now = new Date()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return new Date(now.getFullYear(), now.getMonth(), Math.min(day, lastDay))
}

const ICONS = { income: '💰', transfer: '💸', expense: '🧾' }

export default function RecurringDue() {
  const { data, update } = useRecurring()
  const expenses = useCollection('expenses')
  const income = useCollection('income')
  const transfers = useCollection('transfers')
  const { toast } = useToast()
  const autoPosting = useRef(new Set())

  const monthKey = format(new Date(), 'yyyy-MM')
  const today = new Date().getDate()

  const due = data.filter(
    (r) => r.active && r.lastGeneratedMonth !== monthKey && today >= Math.min(r.dayOfMonth, 28)
  )

  const post = async (r) => {
    const date = dateForDay(r.dayOfMonth)
    if (r.kind === 'income') {
      await income.add({
        amount: r.amount,
        source: r.source || r.label,
        gross: null,
        net: null,
        note: r.label,
        date,
      })
    } else if (r.kind === 'transfer') {
      let rate = 0
      try {
        rate = await fetchLiveJpyInrRate()
      } catch {
        rate = 0
      }
      await transfers.add({
        amountSent: r.amount,
        amountReceived: rate ? r.amount * rate : 0,
        exchangeRate: rate,
        fee: r.fee || 0,
        date,
        recipient: r.recipient || 'Parents',
        method: r.method || 'Wise',
        note: r.label,
      })
    } else {
      await expenses.add({
        amount: r.amount,
        category: r.category || 'Bills',
        country: r.country || 'JP',
        paymentMethod: r.paymentMethod || 'Cash',
        note: r.label,
        date,
      })
    }
    await update(r.id, { lastGeneratedMonth: monthKey })
  }

  const describe = (r) => (r.kind === 'transfer' ? `${r.label} — check the rate` : r.label)

  const manualDue = due.filter((r) => !r.autoPost)

  useEffect(() => {
    for (const r of due) {
      if (r.autoPost && !autoPosting.current.has(r.id)) {
        autoPosting.current.add(r.id)
        post(r).then(() => toast(`✓ Auto-posted ${describe(r)}`))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due])

  if (manualDue.length === 0) return null

  const handleAdd = (r) => post(r).then(() => toast(`✓ Logged ${describe(r)}`))

  const handleSkip = async (r) => {
    await update(r.id, { lastGeneratedMonth: monthKey })
    toast(`Skipped ${r.label} this month`)
  }

  return (
    <div className="card p-4 space-y-3 border-amber-200 dark:border-amber-500/30">
      <div className="flex items-center gap-2">
        <span className="text-base">🔔</span>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Due this month</h2>
      </div>
      <div className="space-y-2">
        {manualDue.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate dark:text-gray-100">
                {ICONS[r.kind] || '🧾'} {r.label}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {formatJPY(r.amount)} · day {r.dayOfMonth}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleSkip(r)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-transform active:scale-90 dark:text-gray-400"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => handleAdd(r)}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                Add
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
