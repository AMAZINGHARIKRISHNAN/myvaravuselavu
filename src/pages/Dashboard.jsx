import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight, Wallet, Receipt, Send, TrendingUp, LineChart, TrendingDown, LifeBuoy, Plus, ScanLine } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useSettings } from '../hooks/useSettings'
import { useAnimatedNumber } from '../hooks/useAnimatedNumber'
import { useToast } from '../context/ToastContext'
import { useTheme } from '../context/ThemeContext'
import { monthRange } from '../lib/dateRanges'
import { formatJPY, formatINR, formatPercent } from '../lib/format'
import { profitEvents, splitGainLoss } from '../lib/profit'
import { buildInsights } from '../lib/insights'
import { sumIn, sumByCategory, inCountry } from '../lib/money'
import { daysUntilSalary, lastNDaysTotals, todayTotal } from '../lib/streak'
import { computeSafeToSpend } from '../lib/planning'
import { useRecurring } from '../hooks/useRecurring'
import GreetingHeader from '../components/dashboard/GreetingHeader'
import HudGreeting from '../components/hud/HudGreeting'
import MonthlyReportCard from '../components/dashboard/MonthlyReportCard'
import RateBanner from '../components/dashboard/RateBanner'
import AccountsCard from '../components/dashboard/AccountsCard'
import QuickAdd from '../components/entry/QuickAdd'
import EntryFlow from '../components/entry/EntryFlow'
import BudgetProgress from '../components/dashboard/BudgetProgress'
import QuickRepeat from '../components/dashboard/QuickRepeat'
import RecurringDue from '../components/dashboard/RecurringDue'
import ShareSummaryButton from '../components/dashboard/ShareSummaryButton'
import ImageReportButton from '../components/dashboard/ImageReportButton'
import FriendPLCard from '../components/dashboard/FriendPLCard'
import CommuteCard from '../components/dashboard/CommuteCard'
import ShoppingCard from '../components/dashboard/ShoppingCard'
import NotesCard from '../components/dashboard/NotesCard'
import ReviewBanner from '../components/dashboard/ReviewBanner'
import SalaryDayCard from '../components/dashboard/SalaryDayCard'
import OnboardingChecklist from '../components/dashboard/OnboardingChecklist'
import FloatingActionButton from '../components/ui/FloatingActionButton'
import JarvisSheet from '../components/jarvis/JarvisSheet'
import Skeleton from '../components/ui/Skeleton'

// The HUD headline panel pulls in ArcReactor and Framer Motion — lazy, so the
// Dashboard (the one page that ships in the main bundle) stays lean for the
// flat skins that never render it.
const HudHero = lazy(() => import('../components/hud/HudHero'))

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

  const { settings, loading: settingsLoading } = useSettings()
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
  // Lifetime profit ("what I've gained till now") for the stat tile. These
  // no-range subscriptions are shared (via the listener cache) with the Charts
  // and Profit pages, so the tile adds no extra reads.
  const profitFriends = useCollection('friendPurchases')
  const profitClaims = useCollection('commuteClaims')
  const profitOrders = useCollection('onlineOrders')
  const profitPasses = useCollection('commutePasses')
  const profitTrips = useCollection('commuteTrips')
  const profitWindfalls = useCollection('windfalls')
  const profitLosses = useCollection('losses')
  const { toast } = useToast()
  const { hud } = useTheme()
  const [showManual, setShowManual] = useState(false)
  const [showJarvis, setShowJarvis] = useState(false)
  // An expense the assistant heard, handed to the entry sheet prefilled.
  const [jarvisDraft, setJarvisDraft] = useState(null)

  // Home-screen shortcut support: launching the PWA via the "Add expense"
  // shortcut lands on /?action=add — open the entry sheet immediately, then
  // strip the param so refreshes/back don't reopen it.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('action') === 'add') {
      setShowManual(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

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

  // Every headline here is a YEN figure, so only yen records feed it. Rupee
  // spending is real but it is other money — it gets its own line rather than
  // being added in, which is what used to make this screen disagree with the
  // wallet and the charts.
  const totalIncome = sumIn(income.data)
  const totalExpenses = sumIn(expenses.data)
  const inrExpenses = sumIn(expenses.data, 'IN')
  const totalTransfers = transfers.data.reduce((sum, r) => sum + (r.amountSent || 0), 0)
  const savingsRate = totalIncome
    ? (totalIncome - totalExpenses - totalTransfers) / totalIncome
    : NaN
  const netSavings = totalIncome - totalExpenses - totalTransfers
  const animatedNetSavings = useAnimatedNumber(netSavings)

  const prevTotalIncome = sumIn(prevIncome.data)
  const prevTotalExpenses = sumIn(prevExpenses.data)
  const prevTotalTransfers = prevTransfers.data.reduce((sum, r) => sum + (r.amountSent || 0), 0)
  const prevSavingsRate = prevTotalIncome
    ? (prevTotalIncome - prevTotalExpenses - prevTotalTransfers) / prevTotalIncome
    : NaN

  // Budgets are set in yen, so rupee spending must never eat into them.
  const spendByCategory = useMemo(() => sumByCategory(expenses.data), [expenses.data])

  const insights = useMemo(
    () =>
      buildInsights({
        expenses: inCountry(expenses.data),
        prevExpenses: inCountry(prevExpenses.data),
        savingsRate,
        prevSavingsRate,
      }),
    [expenses.data, prevExpenses.data, savingsRate, prevSavingsRate]
  )

  // Salary countdown and today's spend.
  const salaryInDays = settings?.salaryAmount > 0 ? daysUntilSalary(settings?.salaryDate) : null
  const spentToday = useMemo(() => todayTotal(inCountry(expenses.data)), [expenses.data])

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
    () => lastNDaysTotals(inCountry([...expenses.data, ...prevExpenses.data])),
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
  const allTimeIncomeTotal = sumIn(allTimeIncome.data)
  const allTimeExpensesTotal = sumIn(allTimeExpenses.data)
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

  // Previous-month derivations for the report card.
  const prevSpendByCategory = useMemo(() => {
    const totals = {}
    for (const e of prevExpenses.data) {
      totals[e.category] = (totals[e.category] || 0) + (e.amount || 0)
    }
    return totals
  }, [prevExpenses.data])
  const prevTopCategory = Object.entries(prevSpendByCategory).sort((a, b) => b[1] - a[1])[0]?.[0]

  // Lifetime realized profit across every source (friend deals, reimbursement
  // surplus, refunds, passes, windfalls). All-time on purpose — "till now" —
  // so it doesn't reset with the month like the other tiles.
  // Kept as two figures rather than one net number: a quiet +¥0 can be nothing
  // happening or ¥5,000 made and ¥5,000 lost, and those are not the same month.
  const { gained: profitTotal, lost: lossTotal } = useMemo(
    () =>
      splitGainLoss(
        profitEvents({
          friendPurchases: profitFriends.data,
          claims: profitClaims.data,
          orders: profitOrders.data,
          passes: profitPasses.data,
          trips: profitTrips.data,
          windfalls: profitWindfalls.data,
          losses: profitLosses.data,
          fare: settings?.commute?.fare ? settings.commute.fare * 2 : 560,
        })
      ),
    [
      profitFriends.data,
      profitClaims.data,
      profitOrders.data,
      profitPasses.data,
      profitTrips.data,
      profitWindfalls.data,
      profitLosses.data,
      settings?.commute?.fare,
    ]
  )

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
      // Rupees spent this month, shown beside the yen rather than inside it.
      sub: inrExpenses > 0 ? `+ ${formatINR(inrExpenses)} in India` : null,
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
    {
      label: 'Profit · till now',
      value: `+${formatJPY(profitTotal)}`,
      Icon: LineChart,
      tint: 'bg-gradient-to-br from-teal-500/25 to-teal-500/5 text-teal-600 dark:text-teal-400',
      delta: null,
      goodDirection: 'up',
      to: '/profit', // tap through to the full breakdown
    },
    // Right beside it on purpose: profit read on its own is only half the story.
    {
      label: 'Loss · till now',
      value: `−${formatJPY(lossTotal)}`,
      sub: lossTotal > 0 ? `net ${profitTotal - lossTotal >= 0 ? '+' : '−'}${formatJPY(Math.abs(profitTotal - lossTotal))}` : null,
      Icon: TrendingDown,
      tint: 'bg-gradient-to-br from-rose-500/25 to-rose-500/5 text-rose-600 dark:text-rose-400',
      delta: null,
      goodDirection: 'down',
      to: '/profit',
    },
  ]

  // Shared by both heroes verbatim — the Classic gradient card and the HUD
  // reactor panel render the identical buttons, so "share this month" can never
  // mean two different things depending on which suit is on.
  const heroActions = (
    <>
      <ShareSummaryButton
        monthLabel={dateRange.label}
        income={totalIncome}
        expenses={totalExpenses}
        transfers={totalTransfers}
        savingsRate={savingsRate}
      />
      {/* PNG statement of the same month — shareable to family as a picture */}
      <ImageReportButton
        monthLabel={dateRange.label}
        income={totalIncome}
        expenses={totalExpenses}
        transfers={totalTransfers}
        savingsRate={savingsRate}
        spendByCategory={spendByCategory}
      />
      {/* Always-available way into the month-end review; the salary-day
          banner is the reminder, this is the door. */}
      <Link
        to="/review"
        className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/25 active:scale-95 touch-manipulation"
      >
        📋 Review
      </Link>
    </>
  )

  return (
    <div
      className="space-y-5 pb-16 lg:pb-0"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Two columns down to the balances strip, then one full-width row.
          The wide side carries the month you are reading; the narrow side
          carries the standing state — the report card, the accounts, the
          ledgers that do not change as you scrub between months. */}
      <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start lg:gap-5 lg:space-y-0">
      <div className="space-y-5">
      {/* Same header, two voices. The HUD one types its line and gets it from
          askJarvis(), so it quotes the assistant's safe-to-spend rather than a
          second opinion on it. */}
      {hud ? (
        <HudGreeting
          salaryInDays={salaryInDays}
          safe={safeToSpend}
          settings={settings}
          expenses={expenses.data}
        />
      ) : (
        <GreetingHeader salaryInDays={salaryInDays} />
      )}

      <RateBanner transfers={[...transfers.data, ...prevTransfers.data]} />

      {isCurrentMonth && (
        <div className="space-y-3">
          <QuickAdd />
          <QuickRepeat recentExpenses={[...expenses.data, ...prevExpenses.data]} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonthOffset((o) => o + 1)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-300/70 bg-white text-lg text-gray-600 shadow-sm transition-transform active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-900 dark:text-gray-400"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <span key={dateRange.label} className="text-sm font-semibold text-gray-200 animate-[toast-in_0.2s_ease-out]">
          {dateRange.label}
        </span>
        <button
          type="button"
          disabled={isCurrentMonth}
          onClick={() => setMonthOffset((o) => Math.max(o - 1, 0))}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-300/70 bg-white text-lg text-gray-600 shadow-sm transition-transform active:scale-90 disabled:opacity-30 touch-manipulation dark:border-transparent dark:bg-neutral-900 dark:text-gray-400"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Two builds of the same headline. Every figure below is computed once,
          above; the suit only decides how it's drawn. */}
      {hud ? (
        <Suspense fallback={<Skeleton className="h-60 w-full" />}>
          <HudHero
            netSavings={animatedNetSavings}
            savingsRate={savingsRate}
            spentToday={spentToday}
            last7={last7}
            safeToSpend={safeToSpend}
            forecastExpenses={forecastExpenses}
            isCurrentMonth={isCurrentMonth}
            actions={heroActions}
          />
        </Suspense>
      ) : (
      <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 p-5 text-white shadow-[0_12px_40px_rgba(79,70,229,0.35)]">
        <div className="pointer-events-none absolute -top-24 -right-14 h-56 w-56 rounded-full bg-white/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-12 h-56 w-56 rounded-full bg-fuchsia-500/30 blur-3xl" />
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
        <div className="mt-3 flex items-center gap-2">{heroActions}</div>
      </div>
      )}

      {/* Three across, so the six read as a 3x2 block of squares. Six in one
          row only worked when this column was the full page width; inside the
          two-column layout it leaves each tile ~100px, which is where the
          wrapped "Sent to / family" and "net + / ¥83,517" came from. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(({ label, value, sub, Icon, tint, delta: d, goodDirection, to }) => {
          const inner = (
            <>
              <div className="flex items-start justify-between">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
                  <Icon size={16} aria-hidden="true" />
                </span>
                {to ? (
                  <ChevronRight size={15} className="text-gray-400" aria-hidden="true" />
                ) : (
                  <DeltaBadge value={d} goodDirection={goodDirection} />
                )}
              </div>
              <p className="mt-3 text-xl font-bold tabular-nums text-gray-900 dark:text-white">{value}</p>
              <p className="mt-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
              {sub && (
                <p className="mt-0.5 text-[11px] font-medium tabular-nums text-gray-400 dark:text-gray-500">
                  {sub}
                </p>
              )}
            </>
          )
          const cls =
            'card p-4 transition-all duration-200 hover:-translate-y-0.5 dark:hover:border-white/10'
          return to ? (
            <Link key={label} to={to} className={`${cls} block touch-manipulation active:scale-[0.98]`}>
              {inner}
            </Link>
          ) : (
            <div key={label} className={cls}>
              {inner}
            </div>
          )
        })}
      </div>

      {/* The balances strip used to sit here, repeating the same four figures
          the Accounts card states in the column opposite. Wallet is a tab now,
          so the strip has a home of its own and this screen says each number
          once. */}
      <BudgetProgress budgets={settings?.budgets} spendByCategory={spendByCategory} />
      </div>

      {/* The narrow column: standing state. */}
      <div className="space-y-5">
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
        {/* Salary day -> sit down with the month */}
        {isCurrentMonth && <ReviewBanner />}
        {/* Payday (holiday-adjusted): log the salary and tally in any
            reimbursement that arrived bundled inside it. */}
        {isCurrentMonth && <SalaryDayCard />}
        <AccountsCard />
        {/* Profit & loss from friend deals — amounts and % returns */}
        <FriendPLCard />
        {/* Straight to the reconcile screen: after a few days of not logging,
            the balances above drift from the bank's — this is where that gets
            fixed. */}
        <Link
          to="/reconcile"
          className="card flex items-center gap-3 p-4 transition-transform active:scale-[0.99] touch-manipulation hover:-translate-y-0.5"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/25 to-amber-500/5 text-amber-600 dark:text-amber-400">
            <ScanLine size={16} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
              Check against your bank
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Type the real balances — log whatever's missing, date by date
            </span>
          </span>
          <ChevronRight size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
        </Link>
        {isCurrentMonth && <OnboardingChecklist settings={settings} />}
        {isCurrentMonth && <RecurringDue />}

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

      {/* Full width, under both columns: the places you go rather than the
          figures you read. Four across on a wide screen, two on a tablet. */}
      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Daily bus trips + what the office still owes back */}
        <CommuteCard />
        {/* Temu/Shein/Amazon orders — cash vs points, returns & refunds */}
        <ShoppingCard />
        {/* Scratchpad: lists, reminders, anything worth writing down */}
        <NotesCard />
        {insights.map((insight, i) => (
          <div
            key={i}
            className="card flex items-center gap-2.5 p-4 text-sm text-gray-700 dark:text-gray-200"
          >
            <span className="text-base">{insight.icon}</span>
            <span className="min-w-0">{insight.text}</span>
          </div>
        ))}
      </div>

      {isCurrentMonth && (
        <FloatingActionButton label="Manual entry" icon={<Plus size={24} />} onClick={() => setShowManual(true)} />
      )}

      {/* The assistant, parked just above the add button: an arc reactor you
          can talk to. Sits apart from + because asking and logging are
          different intentions. */}
      {isCurrentMonth && (
        <button
          type="button"
          onClick={() => {
            if (navigator.vibrate) navigator.vibrate(10)
            setShowJarvis(true)
          }}
          aria-label="Ask the assistant"
          className="fixed bottom-[calc(9rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/60 bg-neutral-900/90 shadow-lg shadow-cyan-500/25 backdrop-blur transition-all duration-150 hover:scale-105 active:scale-90 touch-manipulation lg:bottom-28 lg:right-8"
        >
          <span className="absolute inset-1.5 rounded-full border border-cyan-300/30" />
          <span className="h-3.5 w-3.5 rounded-full bg-cyan-300 shadow-[0_0_12px_4px_rgba(34,211,238,0.6)]" />
        </button>
      )}

      {showManual && (
        <EntryFlow
          initial={jarvisDraft}
          onClose={() => {
            setShowManual(false)
            setJarvisDraft(null)
          }}
          onSaved={() => {
            setShowManual(false)
            setJarvisDraft(null)
          }}
        />
      )}

      {showJarvis && (
        <JarvisSheet
          onClose={() => setShowJarvis(false)}
          // Heard an expense rather than a question — hand it straight to the
          // entry sheet, prefilled, so it's one confirm rather than a retype.
          onLog={(parsed) => {
            setJarvisDraft(parsed)
            setShowManual(true)
          }}
        />
      )}
    </div>
  )
}
