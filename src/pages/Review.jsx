import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../context/ToastContext'
import { monthRange } from '../lib/dateRanges'
import { formatJPY, formatPercent } from '../lib/format'
import { defaultMonthOffset, gradeForSavingsRate } from '../lib/planning'
import { buildInsights } from '../lib/insights'
import { buildProfitSources } from '../lib/profit'
import { rankStores } from '../lib/stores'
import { CATEGORY_ICONS } from '../lib/constants'
import ImageReportButton from '../components/dashboard/ImageReportButton'
import Skeleton from '../components/ui/Skeleton'

// The month-end moment. Everything the app already knows, assembled into one
// screen you read once a month (on salary day) instead of piecing together
// from five different tabs: what came in, what went out, what you made on the
// side, where it went, whether the budgets held, and what's free to send home.

const GRADE_STYLES = {
  A: 'bg-emerald-500',
  B: 'bg-teal-500',
  C: 'bg-amber-500',
  D: 'bg-orange-500',
  E: 'bg-red-500',
}
const GRADE_LINES = {
  A: 'Outstanding month — keep it rolling.',
  B: 'Solid month. You saved well.',
  C: 'Decent — room to tighten up.',
  D: 'You roughly broke even.',
  E: 'Spent more than you earned this month.',
}

const round1000 = (v) => Math.floor(v / 1000) * 1000

export default function Review() {
  const { settings, loading: settingsLoading, save } = useSettings()
  const { toast } = useToast()
  // Derived until the user picks a month, so the default self-corrects once
  // settings (and the real salary date) finish loading.
  const [pickedOffset, setPickedOffset] = useState(null)
  const offset = pickedOffset ?? defaultMonthOffset(settings?.salaryDate || 25)
  const setOffset = (next) => setPickedOffset((prev) => next(prev ?? offset))

  const range = useMemo(() => monthRange(offset), [offset])
  const prevRange = useMemo(() => monthRange(offset + 1), [offset])

  const income = useCollection('income', { dateRange: range })
  const expenses = useCollection('expenses', { dateRange: range })
  const transfers = useCollection('transfers', { dateRange: range })
  const prevExpenses = useCollection('expenses', { dateRange: prevRange })
  const prevIncome = useCollection('income', { dateRange: prevRange })
  const prevTransfers = useCollection('transfers', { dateRange: prevRange })
  // Profit sources carry their own dates, so they're read whole and filtered
  // to the month in memory rather than by three more range queries.
  const friendPurchases = useCollection('friendPurchases')
  const claims = useCollection('commuteClaims')
  const orders = useCollection('onlineOrders')
  const passes = useCollection('commutePasses')
  const commuteTrips = useCollection('commuteTrips')
  const windfalls = useCollection('windfalls')
  const losses = useCollection('losses')

  const sum = (rows, pick = (r) => r.amount) => rows.reduce((s, r) => s + (pick(r) || 0), 0)

  const totalIncome = sum(income.data)
  const totalExpenses = sum(expenses.data)
  const totalSent = sum(transfers.data, (r) => r.amountSent)
  const kept = totalIncome - totalExpenses - totalSent
  const savingsRate = totalIncome ? kept / totalIncome : NaN
  const grade = gradeForSavingsRate(savingsRate)

  const prevKept =
    sum(prevIncome.data) - sum(prevExpenses.data) - sum(prevTransfers.data, (r) => r.amountSent)

  const spendByCategory = useMemo(() => {
    const totals = {}
    for (const e of expenses.data) totals[e.category] = (totals[e.category] || 0) + (e.amount || 0)
    return totals
  }, [expenses.data])
  const topCategories = useMemo(
    () =>
      Object.entries(spendByCategory)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 3),
    [spendByCategory]
  )
  const topStores = useMemo(() => rankStores(expenses.data, { limit: 3 }), [expenses.data])

  const profit = useMemo(
    () =>
      buildProfitSources({
        friendPurchases: friendPurchases.data,
        claims: claims.data,
        orders: orders.data,
        passes: passes.data,
        trips: commuteTrips.data,
        windfalls: windfalls.data,
        losses: losses.data,
        fare: settings?.commute?.fare ? settings.commute.fare * 2 : 560,
        range,
      }),
    [friendPurchases.data, claims.data, orders.data, passes.data, commuteTrips.data, windfalls.data, losses.data, settings?.commute?.fare, range]
  )

  const insights = useMemo(
    () =>
      buildInsights({
        expenses: expenses.data,
        prevExpenses: prevExpenses.data,
        savingsRate,
        prevSavingsRate: sum(prevIncome.data)
          ? prevKept / sum(prevIncome.data)
          : NaN,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses.data, prevExpenses.data, savingsRate, prevKept]
  )

  // Budgets: which caps held and which broke, this month.
  const budgets = useMemo(() => {
    const entries = Object.entries(settings?.budgets || {}).filter(([, cap]) => cap > 0)
    return entries
      .map(([category, cap]) => ({
        category,
        cap,
        spent: spendByCategory[category] || 0,
      }))
      .sort((a, b) => b.spent / b.cap - a.spent / a.cap)
  }, [settings?.budgets, spendByCategory])
  const blown = budgets.filter((b) => b.spent > b.cap)

  // What's free to send home: what you kept, minus your savings target, minus
  // anything already sent this month. Rounded down to a clean ¥1,000.
  const savingsTarget = settings?.monthlySavingsTarget || 0
  const sendable = round1000(Math.max(0, kept - savingsTarget))

  const loading =
    settingsLoading ||
    income.loading ||
    expenses.loading ||
    transfers.loading ||
    friendPurchases.loading ||
    claims.loading ||
    orders.loading

  const reviewed = settings?.lastReviewedMonth === range.key
  const markReviewed = async () => {
    try {
      await save({ lastReviewedMonth: range.key })
      toast(`✓ ${range.label} reviewed`)
    } catch {
      toast('⚠️ Could not save — check your connection')
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const nothingHappened = totalIncome === 0 && totalExpenses === 0 && totalSent === 0

  return (
    <div className="space-y-4 pb-16 lg:mx-auto lg:max-w-3xl lg:pb-0">
      {/* Month switcher — review any past month, never a future one */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset((o) => o + 1)}
          aria-label="Previous month"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/10 text-gray-200 transition-transform active:scale-90 touch-manipulation"
        >
          <ChevronLeft size={16} />
        </button>
        <p className="text-sm font-semibold text-white">📋 {range.label} review</p>
        <button
          type="button"
          onClick={() => setOffset((o) => Math.max(0, o - 1))}
          disabled={offset === 0}
          aria-label="Next month"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/10 text-gray-200 transition-transform active:scale-90 touch-manipulation disabled:opacity-30"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {nothingHappened ? (
        <div className="card p-8 text-center">
          <p className="text-3xl">🗓️</p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Nothing was logged in {range.label}.
          </p>
        </div>
      ) : (
        <>
          {/* ---- Hero: the grade and the one number that matters ---- */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 p-5 text-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
            <div className="pointer-events-none absolute -top-20 -right-14 h-44 w-44 rounded-full bg-violet-600/40 blur-3xl" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-white/60">You kept</p>
                <p className="text-3xl font-black tabular-nums">{formatJPY(kept)}</p>
                <p className="mt-1 text-xs text-white/70">
                  {Number.isFinite(savingsRate) ? `${formatPercent(savingsRate)} of what came in` : 'no income logged'}
                  {prevKept !== 0 && (
                    <>
                      {' · '}
                      <span className={kept >= prevKept ? 'text-emerald-400' : 'text-red-400'}>
                        {kept >= prevKept ? '▲' : '▼'} {formatJPY(Math.abs(kept - prevKept))} vs last month
                      </span>
                    </>
                  )}
                </p>
              </div>
              {grade && (
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-black ${GRADE_STYLES[grade]}`}
                >
                  {grade}
                </span>
              )}
            </div>
            {grade && <p className="mt-3 text-sm text-white/90">{GRADE_LINES[grade]}</p>}
          </div>

          {/* Close the books: reconcile balances and log the month's bills */}
          <Link
            to="/audit"
            className="card flex items-center gap-3 p-4 transition-transform active:scale-[0.99] touch-manipulation"
          >
            <span className="text-xl" aria-hidden="true">🧮</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                Month-end audit
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Log bills, cross-check every balance, catch anything missing
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
          </Link>

          {/* ---- The flow: in, out, home ---- */}
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              💴 The month in three numbers
            </h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Came in" value={formatJPY(totalIncome)} tone="emerald" />
              <Stat label="Went out" value={formatJPY(totalExpenses)} tone="red" />
              <Stat label="Sent home" value={formatJPY(totalSent)} tone="indigo" />
            </div>
          </div>

          {/* ---- Profit made on the side ---- */}
          <div className="card p-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                💹 Profit this month
              </h2>
              <span
                className={`text-lg font-bold tabular-nums ${
                  profit.total > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : profit.total < 0
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                {profit.total > 0 ? '+' : profit.total < 0 ? '−' : ''}
                {formatJPY(Math.abs(profit.total))}
              </span>
            </div>
            {profit.sources.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                No side profit this month — reimbursements, friend deals and refunds all came out
                even.
              </p>
            ) : (
              <div className="space-y-1">
                {profit.sources.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-gray-600 dark:text-gray-300">
                      {s.icon} {s.label}
                    </span>
                    <span
                      className={`shrink-0 font-semibold tabular-nums ${
                        (s.amount || 0) >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-500 dark:text-red-400'
                      }`}
                    >
                      {(s.amount || 0) >= 0 ? '+' : '−'}
                      {formatJPY(Math.abs(s.amount || 0))}
                    </span>
                  </div>
                ))}
                {profit.pendingTotal > 0 && (
                  <p className="pt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    ⏳ {formatJPY(profit.pendingTotal)} approved but not received yet.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ---- Where it went ---- */}
          <div className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              🧭 Where the money went
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  Top categories
                </p>
                {topCategories.length === 0 && <p className="text-xs text-gray-400">—</p>}
                {topCategories.map((c) => (
                  <div key={c.name} className="flex justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">
                      {CATEGORY_ICONS[c.name] || '📌'} {c.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
                      {formatJPY(c.value)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  Biggest stores
                </p>
                {topStores.length === 0 && (
                  <p className="text-xs text-gray-400">No stores tagged this month</p>
                )}
                {topStores.map((s) => (
                  <div key={s.name} className="flex justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">
                      🏪 {s.name}
                      <span className="text-gray-400"> · {s.count}×</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
                      {formatJPY(s.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <Link
              to="/charts"
              className="block text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              See the full breakdown →
            </Link>
          </div>

          {/* ---- Budgets ---- */}
          {budgets.length > 0 && (
            <div className="card space-y-2 p-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                🎯 Budgets{' '}
                <span className="font-normal text-gray-500 dark:text-gray-400">
                  · {blown.length === 0 ? 'all held 🎉' : `${blown.length} broken`}
                </span>
              </h2>
              {budgets.map((b) => {
                const over = b.spent > b.cap
                return (
                  <div key={b.category} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">
                      {CATEGORY_ICONS[b.category] || '📌'} {b.category}
                    </span>
                    <span
                      className={`shrink-0 tabular-nums ${
                        over
                          ? 'font-semibold text-red-500 dark:text-red-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {formatJPY(b.spent)} / {formatJPY(b.cap)}
                      {over && ` · +${formatJPY(b.spent - b.cap)}`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* ---- What to send home ---- */}
          <div className="card space-y-2 p-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              💝 What to send home
            </h2>
            {totalSent > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Already sent this month:{' '}
                <span className="font-semibold text-gray-800 dark:text-gray-100">
                  {formatJPY(totalSent)}
                </span>
              </p>
            )}
            {sendable > 0 ? (
              <>
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  You could send{' '}
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">
                    {formatJPY(sendable)}
                  </span>{' '}
                  and still keep
                  {savingsTarget > 0 ? ` your ${formatJPY(savingsTarget)} savings target` : ' the rest'}.
                </p>
                <Link to="/transfers" className="btn-primary block py-2.5 text-center text-sm">
                  💸 Send money home
                </Link>
              </>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Nothing spare this month once your savings target is covered — no pressure to send.
              </p>
            )}
          </div>

          {/* ---- Insights ---- */}
          {insights.length > 0 && (
            <div className="space-y-2">
              {insights.map((insight, i) => (
                <div
                  key={i}
                  className="card flex items-center gap-2.5 p-3 text-xs text-gray-700 dark:text-gray-200"
                >
                  <span className="text-base">{insight.icon}</span>
                  {insight.text}
                </div>
              ))}
            </div>
          )}

          {/* ---- Close the loop ---- */}
          <div className="card flex items-center justify-between gap-2 p-4">
            <ImageReportButton
              monthLabel={range.label}
              income={totalIncome}
              expenses={totalExpenses}
              transfers={totalSent}
              savingsRate={savingsRate}
              spendByCategory={spendByCategory}
            />
            <button
              type="button"
              onClick={markReviewed}
              disabled={reviewed}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                reviewed
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-indigo-600 text-white dark:bg-indigo-500'
              }`}
            >
              <Check size={13} aria-hidden="true" />
              {reviewed ? 'Reviewed' : 'Mark reviewed'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'red'
        ? 'text-red-500 dark:text-red-400'
        : 'text-indigo-600 dark:text-indigo-400'
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-100/80 p-3 dark:border-transparent dark:bg-neutral-800/50">
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}
