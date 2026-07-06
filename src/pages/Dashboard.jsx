import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight, Wallet, Receipt, Send, TrendingUp, LifeBuoy, Plus } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useSettings } from '../hooks/useSettings'
import { useAnimatedNumber } from '../hooks/useAnimatedNumber'
import { useToast } from '../context/ToastContext'
import { monthRange } from '../lib/dateRanges'
import { formatJPY, formatPercent } from '../lib/format'
import { buildInsights } from '../lib/insights'
import { computeStreak, daysUntilSalary, lastNDaysTotals, todayTotal } from '../lib/streak'
import { computeSafeToSpend } from '../lib/planning'
import { ACHIEVEMENTS, evaluateAchievements } from '../lib/achievements'
import { celebrate } from '../lib/celebrate'
import { useRecurring } from '../hooks/useRecurring'
import GreetingHeader from '../components/dashboard/GreetingHeader'
import MonthlyReportCard from '../components/dashboard/MonthlyReportCard'
import RateBanner from '../components/dashboard/RateBanner'
import AccountsCard from '../components/dashboard/AccountsCard'
import QuickAdd from '../components/entry/QuickAdd'
import EntryFlow from '../components/entry/EntryFlow'
import BudgetProgress from '../components/dashboard/BudgetProgress'
import QuickRepeat from '../components/dashboard/QuickRepeat'
import RecurringDue from '../components/dashboard/RecurringDue'
import ShareSummaryButton from '../components/dashboard/ShareSummaryButton'
import OnboardingChecklist from '../components/dashboard/OnboardingChecklist'
import FloatingActionButton from '../components/ui/FloatingActionButton'
import Skeleton from '../components/ui/Skeleton'

const BUDGET_ALERTS_KEY = 'vs_budget_alerted'

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

  const { settings, loading: settingsLoading, save: saveSettings } = useSettings()
  const emergencyGoal = settings?.emergencyFundGoal || 0
  // The all-time listeners only exist to feed the emergency fund tracker —
  // skip them entirely (and their reads) unless a goal is configured.
  const emergencyEnabled = !settingsLoading && emergencyGoal > 0

  const income = useCollection('income', { dateRange })
  const expenses = useCollection('expenses', { dateRange })
  const transfers = useCollection('transfers', { dateRange })
  const prevIncome = useCollection('income', { dateRange: prevRange })
  const prevExpenses = useCollection('expenses', { dateRange: prevRange })
  const prevTransfers = useCollection('transfers', { dateRange: prevRange })
  const allTimeIncome = useCollection('income', { enabled: emergencyEnabled })
  const allTimeExpenses = useCollection('expenses', { enabled: emergencyEnabled })
  const allTimeTransfers = useCollection('transfers', { enabled: emergencyEnabled })
  const { toast } = useToast()
  const [showManual, setShowManual] = useState(false)

  // Horizontal swipe anywhere on the page moves between months (right = older).
  const touchStart = useRef(null)
  const handleTouchStart = (e) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const handleTouchEnd = (e) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return
    if (dx > 0) {
      setMonthOffset((o) => o + 1)
    } else {
      setMonthOffset((o) => Math.max(o - 1, 0))
    }
  }

  const totalIncome = income.data.reduce((sum, r) => sum + (r.amount || 0), 0)
  const totalExpenses = expenses.data.reduce((sum, r) => sum + (r.amount || 0), 0)
  const totalTransfers = transfers.data.reduce((sum, r) => sum + (r.amountSent || 0), 0)
  const savingsRate = totalIncome
    ? (totalIncome - totalExpenses - totalTransfers) / totalIncome
    : NaN
  const netSavings = totalIncome - totalExpenses - totalTransfers
  const animatedNetSavings = useAnimatedNumber(netSavings)

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

  // Habit signals: logging streak (any record type counts), salary countdown,
  // today's spend, and a 7-day pulse for the hero sparkline.
  const streak = useMemo(
    () =>
      computeStreak([
        ...expenses.data,
        ...income.data,
        ...transfers.data,
        ...prevExpenses.data,
        ...prevIncome.data,
        ...prevTransfers.data,
      ]),
    [expenses.data, income.data, transfers.data, prevExpenses.data, prevIncome.data, prevTransfers.data]
  )
  const salaryInDays = settings?.salaryAmount > 0 ? daysUntilSalary(settings?.salaryDate) : null
  const spentToday = useMemo(() => todayTotal(expenses.data), [expenses.data])

  // Safe-to-spend: expected income minus savings target, what's already gone,
  // and recurring items still due — spread over the days left this month.
  const recurring = useRecurring()
  const thisMonthKey = format(new Date(), 'yyyy-MM')
  const upcomingRecurring = recurring.data
    .filter(
      (r) =>
        r.active &&
        r.lastGeneratedMonth !== thisMonthKey &&
        (r.kind === 'expense' || r.kind === 'transfer')
    )
    .reduce((sum, r) => sum + (r.amount || 0) + (r.kind === 'transfer' ? r.fee || 0 : 0), 0)
  const last7 = useMemo(
    () => lastNDaysTotals([...expenses.data, ...prevExpenses.data]),
    [expenses.data, prevExpenses.data]
  )
  const last7Max = Math.max(...last7.map((d) => d.value), 1)

  const expectedIncome = Math.max(totalIncome, settings?.salaryAmount || 0)
  const safeToSpend =
    isCurrentMonth && expectedIncome > 0
      ? computeSafeToSpend({
          expectedIncome,
          savingsTarget: settings?.monthlySavingsTarget || 0,
          spent: totalExpenses + totalTransfers,
          upcoming: upcomingRecurring,
        })
      : null

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
  const emergencyProgress = emergencyGoal > 0 ? allTimeSaved / emergencyGoal : 0
  const emergencyFundLoading =
    settingsLoading || allTimeIncome.loading || allTimeExpenses.loading || allTimeTransfers.loading

  // Budget alerts: batch newly-crossed categories into one toast per level, per month.
  // Alerted keys live in sessionStorage so navigating away and back doesn't replay them.
  useEffect(() => {
    if (!isCurrentMonth || !settings?.budgets) return
    let alerted
    try {
      alerted = new Set(JSON.parse(sessionStorage.getItem(BUDGET_ALERTS_KEY) || '[]'))
    } catch {
      alerted = new Set()
    }
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
      if (alerted.has(key)) continue
      alerted.add(key)
      ;(level === 'over' ? newOver : newNear).push(category)
    }
    if (newOver.length > 0 || newNear.length > 0) {
      sessionStorage.setItem(
        BUDGET_ALERTS_KEY,
        // Only keep this month's keys so the entry doesn't grow forever.
        JSON.stringify([...alerted].filter((k) => k.startsWith(monthKey)))
      )
    }
    if (newOver.length > 0) toast(`⚠️ Over budget: ${newOver.join(', ')}`)
    if (newNear.length > 0) toast(`⚠️ Near budget: ${newNear.join(', ')}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendByCategory, settings?.budgets, isCurrentMonth])

  // Previous-month derivations for the report card + achievements.
  const prevSpendByCategory = useMemo(() => {
    const totals = {}
    for (const e of prevExpenses.data) {
      totals[e.category] = (totals[e.category] || 0) + (e.amount || 0)
    }
    return totals
  }, [prevExpenses.data])
  const prevTopCategory = Object.entries(prevSpendByCategory).sort((a, b) => b[1] - a[1])[0]?.[0]

  // Award newly-earned achievements (persisted in settings so they stick).
  const coreLoading =
    expenses.loading || income.loading || transfers.loading ||
    prevExpenses.loading || prevIncome.loading || prevTransfers.loading
  useEffect(() => {
    if (settingsLoading || !settings || coreLoading) return
    const budgetEntries = Object.entries(settings.budgets || {}).filter(([, cap]) => cap > 0)
    const budgetsRespectedLastMonth =
      budgetEntries.length > 0 &&
      prevExpenses.data.length > 0 &&
      budgetEntries.every(([cat, cap]) => (prevSpendByCategory[cat] || 0) <= cap)
    const recordCount =
      expenses.data.length + income.data.length + transfers.data.length +
      prevExpenses.data.length + prevIncome.data.length + prevTransfers.data.length
    const finiteRates = [savingsRate, prevSavingsRate].filter(Number.isFinite)
    const earnedNow = evaluateAchievements({
      recordCount,
      streak,
      bestMonthSavingsRate: finiteRates.length ? Math.max(...finiteRates) : null,
      budgetsRespectedLastMonth,
      maxMonthlySent: Math.max(totalTransfers, prevTotalTransfers),
      allTimeSaved: emergencyEnabled ? allTimeSaved : null,
    })
    const existing = settings.achievements || {}
    const fresh = earnedNow.filter((id) => !existing[id])
    if (fresh.length === 0) return
    const updated = { ...existing }
    for (const id of fresh) updated[id] = new Date().toISOString()
    saveSettings({ achievements: updated })
    const first = ACHIEVEMENTS.find((a) => a.id === fresh[0])
    toast(`🏆 Achievement unlocked: ${first.icon} ${first.title}`)
    celebrate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoading, coreLoading, streak, savingsRate, prevSavingsRate, totalTransfers, prevTotalTransfers, allTimeSaved, settings?.achievements])

  const cards = [
    {
      label: 'Income',
      value: formatJPY(totalIncome),
      Icon: Wallet,
      tint: 'bg-gradient-to-br from-emerald-500/25 to-emerald-500/5 text-emerald-600 dark:text-emerald-400',
      delta: delta(totalIncome, prevTotalIncome),
      goodDirection: 'up',
    },
    {
      label: 'Expenses',
      value: formatJPY(totalExpenses),
      Icon: Receipt,
      tint: 'bg-gradient-to-br from-rose-500/25 to-rose-500/5 text-rose-600 dark:text-rose-400',
      delta: delta(totalExpenses, prevTotalExpenses),
      goodDirection: 'down',
    },
    {
      label: 'Sent to family',
      value: formatJPY(totalTransfers),
      Icon: Send,
      tint: 'bg-gradient-to-br from-indigo-500/25 to-indigo-500/5 text-indigo-600 dark:text-indigo-400',
      delta: delta(totalTransfers, prevTotalTransfers),
      goodDirection: 'down',
    },
    {
      label: 'Savings rate',
      value: formatPercent(savingsRate),
      Icon: TrendingUp,
      tint: 'bg-gradient-to-br from-violet-500/25 to-violet-500/5 text-violet-600 dark:text-violet-400',
      delta: Number.isFinite(prevSavingsRate) && Number.isFinite(savingsRate) ? savingsRate - prevSavingsRate : null,
      goodDirection: 'up',
    },
  ]

  return (
    <div
      className="space-y-6 pb-16 lg:pb-0"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <GreetingHeader streak={streak} salaryInDays={salaryInDays} />

      <RateBanner transfers={[...transfers.data, ...prevTransfers.data]} />

      {isCurrentMonth && (
        <div className="space-y-3 lg:max-w-2xl">
          <QuickAdd />
          <QuickRepeat recentExpenses={[...expenses.data, ...prevExpenses.data]} />
        </div>
      )}

      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6 lg:space-y-0">
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonthOffset((o) => o + 1)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-lg text-gray-500 shadow-sm transition-transform active:scale-90 touch-manipulation dark:bg-neutral-900 dark:text-gray-400"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{dateRange.label}</span>
        <button
          type="button"
          disabled={isCurrentMonth}
          onClick={() => setMonthOffset((o) => Math.max(o - 1, 0))}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-lg text-gray-500 shadow-sm transition-transform active:scale-90 disabled:opacity-30 touch-manipulation dark:bg-neutral-900 dark:text-gray-400"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 p-5 text-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
        <div className="pointer-events-none absolute -top-24 -right-14 h-56 w-56 rounded-full bg-indigo-600/50 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-12 h-56 w-56 rounded-full bg-fuchsia-600/30 blur-3xl" />
        <p className="text-xs font-medium text-white/60">Net savings</p>
        <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums">
          {formatJPY(Math.round(animatedNetSavings))}
        </p>
        <p className="mt-1 text-xs text-white/60">{formatPercent(savingsRate)} of income kept</p>

        {isCurrentMonth && (
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium text-white/60">Spent today</p>
              <p className="text-lg font-bold tabular-nums">{formatJPY(spentToday)}</p>
            </div>
            <div className="flex h-10 items-end gap-1" aria-label="Spending, last 7 days">
              {last7.map((d, i) => (
                <div
                  key={d.key}
                  className={`w-2.5 origin-bottom rounded-full animate-[bar-rise_0.5s_ease-out] ${
                    i === last7.length - 1 ? 'bg-white/80' : 'bg-white/30'
                  }`}
                  style={{ height: `${Math.max(12, (d.value / last7Max) * 100)}%` }}
                />
              ))}
            </div>
          </div>
        )}

        {safeToSpend && (
          <div
            className={`mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5 backdrop-blur-sm ${
              safeToSpend.available >= 0 ? 'bg-white/10' : 'bg-red-500/25'
            }`}
          >
            <span className="text-base" aria-hidden="true">
              {safeToSpend.available >= 0 ? '☂️' : '⚠️'}
            </span>
            {safeToSpend.available >= 0 ? (
              <p className="text-xs text-white/80">
                Safe to spend{' '}
                <span className="text-sm font-bold tabular-nums text-white">
                  {formatJPY(Math.round(safeToSpend.perDay))}
                </span>
                /day · {safeToSpend.daysLeft} day{safeToSpend.daysLeft === 1 ? '' : 's'} left
              </p>
            ) : (
              <p className="text-xs text-white/90">
                Over plan by{' '}
                <span className="font-bold tabular-nums">{formatJPY(Math.abs(Math.round(safeToSpend.available)))}</span>{' '}
                — ease up to protect your savings target
              </p>
            )}
          </div>
        )}

        {forecastExpenses !== null && (
          <p className="mt-3 text-xs text-white/60 border-t border-white/10 pt-2">
            On pace to spend {formatJPY(forecastExpenses)} by month end
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

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map(({ label, value, Icon, tint, delta: d, goodDirection }) => (
          <div
            key={label}
            className="card p-4 transition-all duration-200 hover:-translate-y-0.5 dark:hover:border-white/10"
          >
            <div className="flex items-start justify-between">
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
                <Icon size={16} aria-hidden="true" />
              </span>
              <DeltaBadge value={d} goodDirection={goodDirection} />
            </div>
            <p className="mt-3 text-xl font-bold tabular-nums text-gray-900 dark:text-white">{value}</p>
            <p className="mt-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      <BudgetProgress budgets={settings?.budgets} spendByCategory={spendByCategory} />
      </div>

      {/* Right rail on desktop; flows inline on mobile */}
      <div className="space-y-6">
      {isCurrentMonth && (
        <MonthlyReportCard
          monthKey={prevRange.key}
          monthLabel={prevRange.label}
          income={prevTotalIncome}
          expenses={prevTotalExpenses}
          transfers={prevTotalTransfers}
          savingsRate={prevSavingsRate}
          topCategory={prevTopCategory}
        />
      )}
      <AccountsCard />
      {isCurrentMonth && <OnboardingChecklist settings={settings} />}
      {isCurrentMonth && <RecurringDue />}

      {insights.length > 0 && (
        <div className="space-y-2">
          {insights.map((insight, i) => (
            <div
              key={i}
              className="card flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200"
            >
              <span className="text-base">{insight.icon}</span>
              <span>{insight.text}</span>
            </div>
          ))}
        </div>
      )}

      {emergencyGoal > 0 && emergencyFundLoading && <Skeleton className="h-24 w-full" />}

      {emergencyGoal > 0 && !emergencyFundLoading && (
        <div className="card p-4 space-y-2 transition-transform hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                <LifeBuoy size={14} aria-hidden="true" />
              </span>
              Emergency fund
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatJPY(allTimeSaved)} / {formatJPY(emergencyGoal)}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-emerald-500 animate-[progress-fill_0.7s_ease-out] transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, emergencyProgress * 100))}%` }}
            />
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {formatPercent(emergencyProgress)} of goal saved all-time
          </p>
        </div>
      )}
      </div>
      </div>

      {isCurrentMonth && (
        <FloatingActionButton label="Manual entry" icon={<Plus size={24} />} onClick={() => setShowManual(true)} />
      )}

      {showManual && (
        <EntryFlow onClose={() => setShowManual(false)} onSaved={() => setShowManual(false)} />
      )}
    </div>
  )
}
