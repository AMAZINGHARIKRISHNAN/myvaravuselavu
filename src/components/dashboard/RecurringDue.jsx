import { useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import { format } from 'date-fns'
import { useRecurring } from '../../hooks/useRecurring'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { addRecordAndMarkRecurring } from '../../lib/firestore'
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
  const { user } = useAuth()
  const { toast } = useToast()
  const autoPosting = useRef(new Set())

  const monthKey = format(new Date(), 'yyyy-MM')
  const today = new Date().getDate()

  const due = data.filter(
    (r) => r.active && r.lastGeneratedMonth !== monthKey && today >= Math.min(r.dayOfMonth, 28)
  )

  // Builds the record for a recurring item and writes it together with the
  // recurring doc's lastGeneratedMonth in a single atomic batch.
  const post = async (r) => {
    const date = dateForDay(r.dayOfMonth)
    let name
    let payload
    if (r.kind === 'income') {
      name = 'income'
      payload = {
        amount: r.amount,
        source: r.source || r.label,
        gross: null,
        net: null,
        note: r.label,
        date,
      }
    } else if (r.kind === 'transfer') {
      let rate = 0
      try {
        rate = await fetchLiveJpyInrRate()
      } catch {
        rate = 0
      }
      name = 'transfers'
      payload = {
        amountSent: r.amount,
        amountReceived: rate ? r.amount * rate : 0,
        exchangeRate: rate,
        fee: r.fee || 0,
        date,
        recipient: r.recipient || 'Parents',
        method: r.method || 'Wise',
        note: r.label,
      }
    } else {
      name = 'expenses'
      payload = {
        amount: r.amount,
        category: r.category || 'Bills',
        country: r.country || 'JP',
        paymentMethod: r.paymentMethod || 'Cash',
        note: r.label,
        date,
      }
    }
    await addRecordAndMarkRecurring(user.uid, name, payload, r.id, monthKey)
  }

  const describe = (r) => (r.kind === 'transfer' ? `${r.label} — check the rate` : r.label)

  const manualDue = due.filter((r) => !r.autoPost)

  useEffect(() => {
    for (const r of due) {
      if (r.autoPost && !autoPosting.current.has(r.id)) {
        autoPosting.current.add(r.id)
        post(r)
          .then(() => toast(`✓ Auto-posted ${describe(r)}`))
          .catch(() => {
            // Allow a retry on the next snapshot/render instead of wedging until reload.
            autoPosting.current.delete(r.id)
            toast(`⚠️ Could not auto-post ${r.label} — will retry`)
          })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due])

  if (manualDue.length === 0) return null

  const handleAdd = (r) =>
    post(r)
      .then(() => toast(`✓ Logged ${describe(r)}`))
      .catch(() => toast(`⚠️ Could not log ${r.label} — try again`))

  const handleSkip = async (r) => {
    try {
      await update(r.id, { lastGeneratedMonth: monthKey })
      toast(`Skipped ${r.label} this month`)
    } catch {
      toast(`⚠️ Could not skip ${r.label} — try again`)
    }
  }

  return (
    <div className="card p-4 space-y-3 border-amber-200 dark:border-amber-500/30">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
          <Bell size={14} aria-hidden="true" />
        </span>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Due this month</h2>
      </div>
      <div className="space-y-2">
        {manualDue.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate dark:text-gray-100">
                {ICONS[r.kind] || '🧾'} {r.label}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
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
