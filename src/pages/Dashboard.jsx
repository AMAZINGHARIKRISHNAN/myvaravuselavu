import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useCollection } from '../hooks/useCollection'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../context/ToastContext'
import { monthRange } from '../lib/dateRanges'
import { formatJPY, formatPercent } from '../lib/format'
import { buildInsights } from '../lib/insights'
import QuickAdd from '../components/entry/QuickAdd'
import EntryFlow from '../components/entry/EntryFlow'
import BudgetProgress from '../components/dashboard/BudgetProgress'
import RecurringDue from '../components/dashboard/RecurringDue'
import ShareSummaryButton from '../components/dashboard/ShareSummaryButton'
import OnboardingChecklist from '../components/dashboard/OnboardingChecklist'
import FloatingActionButton from '../components/ui/FloatingActionButton'
import Skeleton from '../components/ui/Skeleton'

function delta(current, previous) {
  if (!previous) return null
  return (current - previous) / previous
}

function DeltaBadge({ value, goodDirection }) {
  if (value === null || !Number.isFinite(value) || value === 0) return null
  const isUp = value > 0
  const isGood = goodDirection === 'up' ? isUp : !isUp
  return (
    <span
      className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${
        isGood
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
          : 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
      }`}
    >
      {isUp ? '▲' : '▼'} {Math.abs(Math.round(value * 100))}%
    </span>
  )
}

export default function Dashboard() {
  const [monthOffset, setMonthOffset] = useState(0)
  const dateRange = useMemo(() => monthRange(monthOffset), [monthOffset])
  const prevRange = useMemo(() => monthRange(monthOffset + 1), [monthOffset])
  const isCurrentMonth = monthOffset === 0

  const income = useCollection('income', { dateRange })
  const expenses = useCollection('expenses', { dateRange })
  const transfers = useCollection('transfers', { dateRange })
  const prevIncome = useCollection('income', { dateRange: prevRange })
  const prevExpenses = useCollection('expenses', { dateRange: prevRange })
  const prevTransfers = useCollection('transfers', { dateRange: prevRange })
  const allTimeIncome = useCollection('income')
  const allTimeExpenses = useCollection('expenses')
  const allTimeTransfers = useCollection('transfers')
  const { settings, loading: settingsLoading } = useSettings()
  const { toast } = useToast()
  const [showManual, setShowManual] = useState(false)
  const alertedRef = useRef(new Set())

  const totalIncome = income.data.reduce((sum, r) => sum + (r.amount || 0), 0)
  const totalExpenses = expenses.data.reduce((sum, r) => sum + (r.amount || 0), 0)
  const totalTransfers = transfers.data.reduce((sum, r) => sum + (r.amountSent || 0), 0)
  const savingsRate = totalIncome
    ? (totalIncome - totalExpenses - totalTransfers) / totalIncome
    : NaN
  const netSavings = totalIncome - totalExpenses - totalTransfers

  const prevTotalIncome = prevIncome.data.reduce((sum, r) => sum + (r.amount || 0), 0)
  const prevTotalExpenses = prevExpenses.data.reduce((sum, r) => sum + (r.amount || 0), 0)
  const prevTotalTransfers = prevTransfers.data.reduce((sum, r) => sum + (r.amountSent || 0), 0)
  const prevSavingsRate = prevTotalIncome
    ? (prevTotalIncome - prevTotalExpenses - prevTotalTransfers) / prevTotalIncome
    : NaN

  const spendByCategory = useMemo(() => {
    const totals = {}
    for (const e of expenses.data) {
      totals[e.category] = (totals[e.category] || 0) + (e.amount || 0)
    }
    return totals
  }, [expenses.data])

  const insights = useMemo(
    () =>
      buildInsights({
        expenses: expenses.data,
        prevExpenses: prevExpenses.data,
        savingsRate,
        prevSavingsRate,
      }),
    [expenses.data, prevExpenses.data, savingsRate, prevSavingsRate]
  )

  // Month-end forecast: projects total spend from the current day-of-month run rate.
  const now = new Date()
  const daysElapsed = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const forecastExpenses = isCurrentMonth && daysElapsed > 0 ? (totalExpenses / daysElapsed) * daysInMonth : null

  // Emergency fund: all-time net savings vs a target set in Settings.
  const allTimeIncomeTotal = allTimeIncome.data.reduce((sum, r) => sum + (r.amount || 0), 0)
  const allTimeExpensesTotal = allTimeExpenses.data.reduce((sum, r) => sum + (r.amount || 0), 0)
  const allTimeTransfersTotal = allTimeTransfers.data.reduce((sum, r) => sum + (r.amountSent || 0), 0)
  const allTimeSaved = allTimeIncomeTotal - allTimeExpensesTotal - allTimeTransfersTotal
  const emergencyGoal = settings?.emergencyFundGoal || 0
  const emergencyProgress = emergencyGoal > 0 ? allTimeSaved / emergencyGoal : 0
  const emergencyFundLoading =
    settingsLoading || allTimeIncome.loading || allTimeExpenses.loading || allTimeTransfers.loading

  // Budget alerts: batch newly-crossed categories into one toast per level, per month.
  useEffect(() => {
    if (!isCurrentMonth || !settings?.budgets) return
    const monthKey = format(now, 'yyyy-MM')
    const newOver = []
    const newNear = []
    for (const [category, cap] of Object.entries(settings.budgets)) {
      if (!(cap > 0)) continue
      const spent = spendByCategory[category] || 0
      const ratio = spent / cap
      const level = ratio >= 1 ? 'over' : ratio >= 0.9 ? 'near' : null
      if (!level) continue
      const key = `${monthKey}-${category}-${level}`
      if (alertedRef.current.has(key)) continue
      alertedRef.current.add(key)
      ;(level === 'over' ? newOver : newNear).push(category)
    }
    if (newOver.length > 0) toast(`⚠️ Over budget: ${newOver.join(', ')}`)
    if (newNear.length > 0) toast(`⚠️ Near budget: ${newNear.join(', ')}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendByCategory, settings?.budgets, isCurrentMonth])

  const cards = [
    { label: 'Income', value: formatJPY(totalIncome), icon: '💰', delta: delta(totalIncome, prevTotalIncome), goodDirection: 'up' },
    { label: 'Expenses', value: formatJPY(totalExpenses), icon: '🧾', delta: delta(totalExpenses, prevTotalExpenses), goodDirection: 'down' },
    { label: 'Sent to family', value: formatJPY(totalTransfers), icon: '💸', delta: delta(totalTransfers, prevTotalTransfers), goodDirection: 'down' },
    {
      label: 'Savings rate',
      value: formatPercent(savingsRate),
      icon: '📈',
      delta: Number.isFinite(prevSavingsRate) && Number.isFinite(savingsRate) ? savingsRate - prevSavingsRate : null,
      goodDirection: 'up',
    },
  ]

  return (
    <div className="space-y-6 pb-16">
      {isCurrentMonth && <QuickAdd />}
      {isCurrentMonth && <OnboardingChecklist settings={settings} />}
      {isCurrentMonth && <RecurringDue />}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonthOffset((o) => o + 1)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-500 shadow-sm transition-transform active:scale-90 dark:bg-neutral-900 dark:text-gray-400"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{dateRange.label}</span>
        <button
          type="button"
          disabled={isCurrentMonth}
          onClick={() => setMonthOffset((o) => Math.max(o - 1, 0))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-500 shadow-sm transition-transform active:scale-90 disabled:opacity-30 dark:bg-neutral-900 dark:text-gray-400"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-5 text-white shadow-lg shadow-indigo-500/20">
        <div className="pointer-events-none absolute -right-6 -top-10 h-32 w-32 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-10 -left-6 h-32 w-32 rounded-full bg-white/10" />
        <p className="text-xs font-medium text-white/70">Net savings</p>
        <p className="mt-1 text-3xl font-bold tracking-tight">{formatJPY(netSavings)}</p>
        <p className="mt-1 text-xs text-white/70">{formatPercent(savingsRate)} of income kept</p>
        {forecastExpenses !== null && (
          <p className="mt-2 text-xs text-white/70 border-t border-white/15 pt-2">
            📅 On pace to spend {formatJPY(forecastExpenses)} by month end
          </p>
        )}
        <div className="mt-3">
          <ShareSummaryButton
            monthLabel={dateRange.label}
            income={totalIncome}
            expenses={totalExpenses}
            transfers={totalTransfers}
            savingsRate={savingsRate}
          />
        </div>
      </div>

      {insights.length > 0 && (
        <div className="space-y-2">
          {insights.map((insight, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm text-gray-700 shadow-sm dark:bg-neutral-900 dark:text-gray-200"
            >
              <span className="text-base">{insight.icon}</span>
              <span>{insight.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="card p-4 transition-transform hover:-translate-y-0.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-base">{card.icon}</span>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500">{card.label}</p>
              </div>
              <DeltaBadge value={card.delta} goodDirection={card.goodDirection} />
            </div>
            <p className="text-xl font-bold text-gray-900 mt-1 dark:text-gray-100">{card.value}</p>
          </div>
        ))}
      </div>

      <BudgetProgress budgets={settings?.budgets} spendByCategory={spendByCategory} />

      {emergencyGoal > 0 && emergencyFundLoading && <Skeleton className="h-24 w-full" />}

      {emergencyGoal > 0 && !emergencyFundLoading && (
        <div className="card p-4 space-y-2 transition-transform hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🛟 Emergency fund</h2>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {formatJPY(allTimeSaved)} / {formatJPY(emergencyGoal)}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden dark:bg-neutral-800">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500"
              style={{ width: `${Math.min(100, Math.max(0, emergencyProgress * 100))}%` }}
            />
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            {formatPercent(emergencyProgress)} of goal saved all-time
          </p>
        </div>
      )}

      {isCurrentMonth && (
        <FloatingActionButton label="Manual entry" icon="📝" onClick={() => setShowManual(true)} />
      )}

      {showManual && (
        <EntryFlow onClose={() => setShowManual(false)} onSaved={() => setShowManual(false)} />
      )}
    </div>
  )
}
