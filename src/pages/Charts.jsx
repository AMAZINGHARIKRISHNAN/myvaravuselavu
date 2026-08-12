import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts'
import { format, subMonths } from 'date-fns'
import { useCollection } from '../hooks/useCollection'
import { useSettings } from '../hooks/useSettings'
import { currentMonthRange, lastNMonthsRange, currentYearRange } from '../lib/dateRanges'
import { profitEvents } from '../lib/profit'
import { formatJPY, formatINR, formatPercent, toDate } from '../lib/format'
import { CATEGORY_ICONS } from '../lib/constants'
import { rankStores, storeCoverage } from '../lib/stores'
import { inCountry, monthTotals } from '../lib/money'
import { useToday } from '../hooks/useToday'
import { useTheme } from '../context/ThemeContext'
import { chartTheme, donutSlices, colorForKey } from '../lib/chartTheme'
import GradientDonut from '../components/charts/GradientDonut'

// Series colors for the trend chart, CVD- and contrast-validated for both the
// white and neutral-900 card surfaces (dataviz six-checks).

function groupSum(records, keyFn, amountFn = (r) => r.amount) {
  const totals = {}
  for (const record of records) {
    const key = keyFn(record) || 'Unknown'
    totals[key] = (totals[key] || 0) + (amountFn(record) || 0)
  }
  return Object.entries(totals).map(([name, value]) => ({ name, value }))
}

const compactYen = (v) =>
  `¥${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}`

// GitHub-style month calendar: green = no-spend day, indigo intensity = spend
// level. Future days are hollow.
function SpendHeatmap({ expenses, formatter }) {
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const today = now.getDate()
  // Monday-first offset for the 1st of the month
  const offset = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7

  const totals = {}
  for (const e of expenses) {
    const d = toDate(e.date)
    if (d) totals[d.getDate()] = (totals[d.getDate()] || 0) + (e.amount || 0)
  }
  const max = Math.max(...Object.values(totals), 1)

  const cellClass = (day) => {
    if (day > today) return 'border border-dashed border-gray-300 text-gray-400 dark:border-neutral-700 dark:text-neutral-600'
    const v = totals[day] || 0
    if (v === 0) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
    if (v / max > 0.66) return 'bg-indigo-600 text-white'
    if (v / max > 0.33) return 'bg-indigo-500/70 text-white'
    return 'bg-indigo-500/35 text-indigo-900 dark:text-indigo-100'
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium text-gray-400 dark:text-gray-500">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1
          return (
            <span
              key={day}
              title={day <= today ? `${day}: ${formatter(totals[day] || 0)}` : undefined}
              className={`flex aspect-square items-center justify-center rounded-lg text-[11px] font-medium tabular-nums transition-colors ${cellClass(day)}`}
            >
              {day}
            </span>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded bg-emerald-100 dark:bg-emerald-500/20" /> no-spend day
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded bg-indigo-500/35" />
          <span className="h-2.5 w-2.5 rounded bg-indigo-500/70" />
          <span className="h-2.5 w-2.5 rounded bg-indigo-600" /> more spend
        </span>
      </div>
    </div>
  )
}

// Ranked horizontal bars: identity lives in the row label, so every bar wears
// the single brand hue — amounts and shares are direct-labeled on each row.
function RankedBars({ data, formatter, icons, theme }) {
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, d) => sum + d.value, 0)
  const max = sorted[0]?.value || 1
  return (
    <div className="space-y-3">
      {sorted.map((d) => (
        <div key={d.name}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-gray-700 truncate dark:text-gray-200">
              {icons?.[d.name] ? `${icons[d.name]} ` : ''}
              {d.name}
            </span>
            <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
              {formatter(d.value)} · {total ? Math.round((d.value / total) * 100) : 0}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
            <div
              className="h-full rounded-full animate-[progress-fill_0.7s_ease-out] transition-all duration-500"
              style={{
                width: `${(d.value / max) * 100}%`,
                // Same colour the slice has in the ring above, so the two
                // halves of the card are obviously the same data.
                background: theme
                  ? `linear-gradient(90deg, ${colorForKey(d.name, theme.categories)}, ${colorForKey(d.name, theme.categories)}99)`
                  : undefined,
                boxShadow: theme?.glow ? `0 0 10px ${colorForKey(d.name, theme.categories)}55` : undefined,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// "Where does the money actually go?" — same ranked-bar language as the
// category chart, but each row also carries trip count and average spend,
// which is what turns a shop list into a decision ("¥400 × 22 visits").
function StoreBars({ stores, formatter }) {
  const max = stores[0]?.total || 1
  const total = stores.reduce((sum, s) => sum + s.total, 0)
  return (
    <div className="space-y-3">
      {stores.map((s, i) => (
        <div key={s.name}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-gray-700 dark:text-gray-200">
              <span className="text-gray-400 dark:text-gray-500">{i + 1}.</span> 🏪 {s.name}
            </span>
            <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
              {formatter(s.total)} · {total ? Math.round((s.total / total) * 100) : 0}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 animate-[progress-fill_0.7s_ease-out] transition-all duration-500"
              style={{ width: `${(s.total / max) * 100}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
            {s.count} {s.count === 1 ? 'visit' : 'visits'} · {formatter(Math.round(s.total / s.count))} avg
          </p>
        </div>
      ))}
    </div>
  )
}

function ChartCard({ title, className = '', children }) {
  return (
    <div className={`card p-4 ${className}`}>
      <h2 className="text-sm font-semibold text-gray-700 mb-3 dark:text-gray-200">{title}</h2>
      {children}
    </div>
  )
}

export default function Charts() {
  const [pieCountry, setPieCountry] = useState('JP')
  const { theme, skin } = useTheme()
  const isDark = theme === 'dark'
  // Every colour, gradient and ring dimension below comes from the active suit,
  // so switching skins re-draws the data as well as the furniture.
  const ct = useMemo(() => chartTheme(skin, isDark), [skin, isDark])
  const gridColor = ct.grid
  const tickColor = ct.tick
  const tooltipStyle = ct.tooltip
  const legendColor = ct.legend
  const accent = ct.accent
  const SERIES = ct.series

  // Keyed on the day, not on []: an installed PWA left open over a month
  // boundary used to keep querying (and captioning) the month it was opened in.
  const today = useToday()
  const monthRange = useMemo(() => currentMonthRange(today), [today])
  const sixMonthRange = useMemo(() => lastNMonthsRange(6, today), [today])
  const yearRange = useMemo(() => currentYearRange(today), [today])

  const monthExpenses = useCollection('expenses', { dateRange: monthRange })
  const rangeIncome = useCollection('income', { dateRange: sixMonthRange })
  const rangeExpenses = useCollection('expenses', { dateRange: sixMonthRange })
  const rangeTransfers = useCollection('transfers', { dateRange: sixMonthRange })
  const yearIncome = useCollection('income', { dateRange: yearRange })
  const yearExpenses = useCollection('expenses', { dateRange: yearRange })
  const yearTransfers = useCollection('transfers', { dateRange: yearRange })
  // Profit sources over the same 6 months. Shared listeners (from the Profit
  // page/card) mean these add no extra reads.
  const { settings } = useSettings()
  const profitFriends = useCollection('friendPurchases')
  const profitClaims = useCollection('commuteClaims')
  const profitOrders = useCollection('onlineOrders')
  const profitPasses = useCollection('commutePasses')
  const profitTrips = useCollection('commuteTrips')
  const profitWindfalls = useCollection('windfalls')
  const profitLosses = useCollection('losses')

  // JP and IN expenses are different currencies — pies never mix them, a toggle switches between them.
  const jpExpenses = useMemo(
    () => monthExpenses.data.filter((e) => (e.country || 'JP') !== 'IN'),
    [monthExpenses.data]
  )
  const inExpenses = useMemo(
    () => monthExpenses.data.filter((e) => e.country === 'IN'),
    [monthExpenses.data]
  )
  const hasInExpenses = inExpenses.length > 0
  const pieExpenses = pieCountry === 'IN' && hasInExpenses ? inExpenses : jpExpenses
  const pieFormatter = pieCountry === 'IN' && hasInExpenses ? formatINR : formatJPY

  const byCategory = useMemo(() => groupSum(pieExpenses, (r) => r.category), [pieExpenses])
  const byPaymentMethod = useMemo(() => groupSum(pieExpenses, (r) => r.paymentMethod), [pieExpenses])

  const monthStores = useMemo(() => rankStores(pieExpenses), [pieExpenses])
  const storeTagRate = useMemo(() => storeCoverage(pieExpenses), [pieExpenses])
  // The year view answers the real question — "which shop got the most of my
  // money overall" — where a single month is too short to be meaningful.
  const yearStores = useMemo(
    () => rankStores(yearExpenses.data.filter((e) => (e.country || 'JP') !== 'IN'), { limit: 5 }),
    [yearExpenses.data]
  )

  const yearSummary = useMemo(() => {
    // Yen only: the card is labelled in ¥, and rupee spending is other money.
    const { income, expenses, transfers: sent } = monthTotals({
      income: yearIncome.data,
      expenses: yearExpenses.data,
      transfers: yearTransfers.data,
    })
    const saved = income - expenses - sent
    return { income, expenses, sent, saved }
  }, [yearIncome.data, yearExpenses.data, yearTransfers.data])

  const monthlyTrend = useMemo(() => {
    // subMonths handles month-length overflow (e.g. running this on the 31st).
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(new Date(), i)
      months.push({ key: format(d, 'yyyy-MM'), label: format(d, 'MMM') })
    }

    const sumByMonth = (records, amountFn = (r) => r.amount) => {
      const totals = {}
      for (const record of records) {
        const date = toDate(record.date)
        if (!date) continue
        const key = format(date, 'yyyy-MM')
        totals[key] = (totals[key] || 0) + (amountFn(record) || 0)
      }
      return totals
    }

    const incomeTotals = sumByMonth(inCountry(rangeIncome.data))
    const expenseTotals = sumByMonth(inCountry(rangeExpenses.data))
    const transferTotals = sumByMonth(rangeTransfers.data, (r) => r.amountSent)

    return months.map(({ key, label }) => {
      const income = incomeTotals[key] || 0
      const expenses = expenseTotals[key] || 0
      const transfers = transferTotals[key] || 0
      const savingsRate = income ? (income - expenses - transfers) / income : null
      return { month: label, income, expenses, transfers, savingsRate }
    })
  }, [rangeIncome.data, rangeExpenses.data, rangeTransfers.data])

  // Realized profit per month, from every source (friend deals, reimbursement
  // surplus, refunds, passes, windfalls). Pending money is left out — this
  // tracks what actually landed.
  const profitTrend = useMemo(() => {
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(new Date(), i)
      months.push({ key: format(d, 'yyyy-MM'), label: format(d, 'MMM') })
    }
    const events = profitEvents({
      friendPurchases: profitFriends.data,
      claims: profitClaims.data,
      orders: profitOrders.data,
      passes: profitPasses.data,
      trips: profitTrips.data,
      windfalls: profitWindfalls.data,
      losses: profitLosses.data,
      fare: settings?.commute?.fare ? settings.commute.fare * 2 : 560,
    })
    const totals = {}
    for (const e of events) {
      if (e.pending || e.country === 'IN' || !e.date) continue
      const key = format(e.date, 'yyyy-MM')
      totals[key] = (totals[key] || 0) + e.amount
    }
    return months.map(({ key, label }) => ({ month: label, profit: totals[key] || 0 }))
  }, [
    profitFriends.data,
    profitClaims.data,
    profitOrders.data,
    profitPasses.data,
    profitTrips.data,
    profitWindfalls.data,
    profitLosses.data,
    settings?.commute?.fare,
  ])
  const hasProfitTrend = profitTrend.some((m) => m.profit !== 0)

  const noExpensesThisMonth = !monthExpenses.loading && pieExpenses.length === 0
  // Recharts happily draws labelled axes around no data at all, which looks
  // like a rendering failure rather than an empty account. One flag decides
  // whether the six-month charts draw or explain themselves.
  const hasTrend = monthlyTrend.some((m) => m.income || m.expenses || m.transfers)

  // Six named slices plus a rolled-up "Other": more than that and a ring stops
  // being readable, however pretty it looks.
  const categoryDonut = useMemo(
    () => donutSlices(byCategory, { max: 6, palette: ct.categories }),
    [byCategory, ct]
  )

  return (
    <div className="space-y-4">
      <ChartCard title="🗓️ Year in review">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <YearStat label="Income" value={formatJPY(yearSummary.income)} icon="💰" />
          <YearStat label="Expenses" value={formatJPY(yearSummary.expenses)} icon="🧾" />
          <YearStat label="Sent to family" value={formatJPY(yearSummary.sent)} icon="💸" />
          <YearStat
            label="Saved"
            value={formatJPY(yearSummary.saved)}
            icon="📈"
            positive={yearSummary.saved >= 0}
          />
        </div>
      </ChartCard>

      {hasInExpenses && (
        <div className="flex rounded-full border border-gray-300/80 bg-white p-1 shadow-sm dark:border-white/5 dark:bg-neutral-900 dark:shadow-none lg:max-w-sm">
          <CountryToggleButton active={pieCountry === 'JP'} onClick={() => setPieCountry('JP')}>
            🇯🇵 Japan
          </CountryToggleButton>
          <CountryToggleButton active={pieCountry === 'IN'} onClick={() => setPieCountry('IN')}>
            🇮🇳 India
          </CountryToggleButton>
        </div>
      )}

      {/* Balanced two-column flow rather than a grid. A grid row is as tall as
          its tallest cell, so the short "payment method" card sat beside the
          tall category ring and left a hole underneath it. Columns fill and
          balance, so the space gets used.
          `break-inside-avoid` stops a card being sliced across the gutter. */}
      <div className="space-y-4 lg:columns-2 lg:gap-4 lg:space-y-0 [&>*]:break-inside-avoid lg:[&>*]:mb-4">
        <ChartCard title={`Spend by category (this month${hasInExpenses ? `, ${pieCountry === 'IN' ? 'India' : 'Japan'}` : ''})`}>
          {noExpensesThisMonth ? (
            <EmptyState />
          ) : (
            <div className="space-y-4">
              {/* The ring answers "what is this month shaped like?" at a glance;
                  the bars underneath answer "how much, exactly?". Neither is
                  enough on its own, so the card carries both. */}
              <GradientDonut
                slices={categoryDonut.slices}
                total={categoryDonut.total}
                centerLabel="Spent"
                centerValue={pieFormatter(categoryDonut.total)}
                formatValue={pieFormatter}
                theme={ct}
              />
              <RankedBars data={byCategory} formatter={pieFormatter} icons={CATEGORY_ICONS} theme={ct} />
            </div>
          )}
        </ChartCard>

        <ChartCard title={`Spend by payment method (this month${hasInExpenses ? `, ${pieCountry === 'IN' ? 'India' : 'Japan'}` : ''})`}>
          {noExpensesThisMonth ? (
            <EmptyState />
          ) : (
            <RankedBars data={byPaymentMethod} formatter={pieFormatter} />
          )}
        </ChartCard>

        <ChartCard title={`🏪 Top stores (this month${hasInExpenses ? `, ${pieCountry === 'IN' ? 'India' : 'Japan'}` : ''})`}>
          {monthStores.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
              No stores tagged yet — add the shop name when you log an expense and
              your most-visited places show up here.
            </p>
          ) : (
            <>
              <StoreBars stores={monthStores} formatter={pieFormatter} />
              {/* Ranking only sees tagged expenses, so say so when most aren't. */}
              {storeTagRate < 0.6 && (
                <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
                  Only {Math.round(storeTagRate * 100)}% of this month's expenses have a store
                  — tag more to make this ranking complete.
                </p>
              )}
            </>
          )}
        </ChartCard>

        <ChartCard title="🏆 Top stores (this year)">
          {yearStores.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
              Nothing tagged this year yet.
            </p>
          ) : (
            <StoreBars stores={yearStores} formatter={formatJPY} />
          )}
        </ChartCard>
      </div>

      <ChartCard
        title={`No-spend heatmap (this month${hasInExpenses ? `, ${pieCountry === 'IN' ? 'India' : 'Japan'}` : ''})`}
      >
        {noExpensesThisMonth ? (
          <EmptyState
            icon="🟩"
            title="Nothing logged this month"
            hint="Every day you spend nothing turns green here — the streak starts with your first entry."
          />
        ) : (
          <SpendHeatmap expenses={pieExpenses} formatter={pieFormatter} />
        )}
      </ChartCard>

      <ChartCard title="Income vs expenses vs transfers (last 6 months)">
        {!hasTrend ? (
          <EmptyState
            icon="📈"
            title="Not enough history yet"
            hint="Once a month or two of income and spending is logged, the shape of it shows up here."
          />
        ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthlyTrend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
            <XAxis dataKey="month" fontSize={12} stroke={tickColor} />
            <YAxis fontSize={12} stroke={tickColor} tickFormatter={compactYen} width={52} />
            <Tooltip formatter={(value) => formatJPY(value)} contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ color: legendColor }} />
            <Bar dataKey="income" fill={SERIES.income} name="Income" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenses" fill={SERIES.expenses} name="Expenses" radius={[4, 4, 0, 0]} />
            <Bar dataKey="transfers" fill={SERIES.transfers} name="Transfers" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Savings rate trend">
        {!hasTrend ? (
          <EmptyState
            icon="🫙"
            title="No savings rate yet"
            hint="A rate needs income to measure against — log a salary and this starts tracking."
          />
        ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={monthlyTrend}>
            <defs>
              <linearGradient id="savingsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
            <XAxis dataKey="month" fontSize={12} stroke={tickColor} />
            <YAxis fontSize={12} stroke={tickColor} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
            <Tooltip formatter={(value) => formatPercent(value)} contentStyle={tooltipStyle} />
            <Area
              type="monotone"
              dataKey="savingsRate"
              stroke={accent}
              strokeWidth={2}
              fill="url(#savingsGradient)"
              dot={{ fill: accent, r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
        )}
      </ChartCard>

      {hasProfitTrend && (
        <ChartCard title="📈 Profit made (last 6 months)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={profitTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
              <XAxis dataKey="month" fontSize={12} stroke={tickColor} />
              <YAxis fontSize={12} stroke={tickColor} tickFormatter={compactYen} width={52} />
              <Tooltip formatter={(value) => formatJPY(value)} contentStyle={tooltipStyle} />
              <Bar dataKey="profit" fill={SERIES.income} name="Profit" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  )
}

function CountryToggleButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full py-2 text-sm font-medium transition-all active:scale-95 touch-manipulation ${
        active
          ? 'bg-indigo-600 text-white dark:bg-indigo-500'
          : 'text-gray-600 dark:text-gray-400'
      }`}
    >
      {children}
    </button>
  )
}

// Says what would fill the space and how to make that happen. A chart frame
// with nothing in it reads as broken on a brand-new account; naming the thing
// that is missing turns it into an instruction.
function EmptyState({
  icon = '📊',
  title = 'No expenses yet this month',
  hint = 'Log one with the + button and this fills in straight away.',
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-14 text-center">
      <span className="text-2xl" aria-hidden="true">
        {icon}
      </span>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{title}</p>
      <p className="max-w-xs text-xs text-gray-500 dark:text-gray-400">{hint}</p>
    </div>
  )
}

function YearStat({ label, value, icon, positive }) {
  const colorClass =
    positive === undefined
      ? 'text-gray-900 dark:text-gray-100'
      : positive
        ? 'text-green-600 dark:text-green-400'
        : 'text-red-500 dark:text-red-400'
  // `stat-tile` is inert on flat skins and becomes a framed instrument readout
  // under a HUD — see index.css.
  return (
    <div className="stat-tile rounded-2xl border border-gray-200 bg-gray-100/80 p-3 dark:border-transparent dark:bg-neutral-800/50">
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      </div>
      <p className={`text-sm font-bold mt-1 ${colorClass}`}>{value}</p>
    </div>
  )
}
