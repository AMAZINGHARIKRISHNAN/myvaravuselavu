import { useState } from 'react'
import { gradeForSavingsRate } from '../../lib/planning'
import { formatJPY, formatPercent } from '../../lib/format'
import ShareSummaryButton from './ShareSummaryButton'

const GRADE_STYLES = {
  A: 'bg-emerald-500',
  B: 'bg-teal-500',
  C: 'bg-amber-500',
  D: 'bg-orange-500',
  E: 'bg-red-500',
}

const GRADE_LINES = {
  A: 'Outstanding month — keep it rolling!',
  B: 'Solid month. You saved well.',
  C: 'Decent — room to tighten up.',
  D: 'You broke even. Next month is yours.',
  E: 'Spent more than earned — regroup this month.',
}

// Last month's report card, shown for the first days of a new month.
// Dismissal is remembered per month.
export default function MonthlyReportCard({ monthKey, monthLabel, income, expenses, transfers, savingsRate, topCategory }) {
  const dismissKey = `vs_report_dismissed_${monthKey}`
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey) === '1')

  const inWindow = new Date().getDate() <= 5
  const hasActivity = income > 0 || expenses > 0 || transfers > 0
  const grade = gradeForSavingsRate(savingsRate)
  if (dismissed || !inWindow || !hasActivity || !grade) return null

  const dismiss = () => {
    localStorage.setItem(dismissKey, '1')
    setDismissed(true)
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 p-4 text-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
      <div className="pointer-events-none absolute -top-20 -right-14 h-44 w-44 rounded-full bg-violet-600/40 blur-3xl" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-white/60">Report card · {monthLabel}</p>
          <p className="mt-1 text-sm text-white/90">{GRADE_LINES[grade]}</p>
        </div>
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-black text-white ${GRADE_STYLES[grade]}`}
        >
          {grade}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-sm font-bold tabular-nums">{formatPercent(savingsRate)}</p>
          <p className="text-[10px] text-white/60">saved</p>
        </div>
        <div>
          <p className="text-sm font-bold tabular-nums">{formatJPY(expenses)}</p>
          <p className="text-[10px] text-white/60">spent</p>
        </div>
        <div>
          <p className="truncate text-sm font-bold">{topCategory || '—'}</p>
          <p className="text-[10px] text-white/60">top category</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2.5">
        <ShareSummaryButton
          monthLabel={monthLabel}
          income={income}
          expenses={expenses}
          transfers={transfers}
          savingsRate={savingsRate}
        />
        <button
          type="button"
          onClick={dismiss}
          className="px-2 py-1 text-xs font-medium text-white/50 transition-colors hover:text-white/80"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
