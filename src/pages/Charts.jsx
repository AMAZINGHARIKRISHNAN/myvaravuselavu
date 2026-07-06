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
import { currentMonthRange, lastNMonthsRange, currentYearRange } from '../lib/dateRanges'
import { formatJPY, formatINR, formatPercent, toDate } from '../lib/format'
import { CATEGORY_ICONS } from '../lib/constants'
import { useTheme } from '../context/ThemeContext'

// Series colors for the trend chart, CVD- and contrast-validated for both the
// white and neutral-900 card surfaces (dataviz six-checks).
const SERIES = { income: '#059669', expenses: '#f43f5e', transfers: '#6366f1' }

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
// level. Future days are hollow. Pairs with the logging streak as a habit game.
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
    if (day > today) return 'border border-dashed border-gray-200 text-gray-300 dark:border-neutral-700 dark:text-neutral-600'
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
function RankedBars({ data, formatter, icons }) {
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
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 animate-[progress-fill_0.7s_ease-out] transition-all duration-500"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
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
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const gridColor = isDark ? '#232b3d' : '#e5e7eb'
  const tickColor = isDark ? '#8b93a7' : '#6b7280'
  const tooltipStyle = isDark
    ? {
        backgroundColor: '#0f1420',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        color: '#f3f4f6',
        boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
      }
    : { borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }
  const legendColor = isDark ? '#d4d4d4' : '#374151'
  const accent = isDark ? '#818cf8' : '#6366f1'

  const monthRange = useMemo(currentMonthRange, [])
  const sixMonthRange = useMemo(() => lastNMonthsRange(6), [])
  const yearRange = useMemo(currentYearRange, [])

  const monthExpenses = useCollection('expenses', { dateRange: monthRange })
  const rangeIncome = useCollection('income', { dateRange: sixMonthRange })
  const rangeExpenses = useCollection('expenses', { dateRange: sixMonthRange })
  const rangeTransfers = useCollection('transfers', { dateRange: sixMonthRange })
  const yearIncome = useCollection('income', { dateRange: yearRange })
  const yearExpenses = useCollection('expenses', { dateRange: yearRange })
  const yearTransfers = useCollection('transfers', { dateRange: yearRange })

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

  const yearSummary = useMemo(() => {
    const income = yearIncome.data.reduce((sum, r) => sum + (r.amount || 0), 0)
    const expenses = yearExpenses.data.reduce((sum, r) => sum + (r.amount || 0), 0)
    const sent = yearTransfers.data.reduce((sum, r) => sum + (r.amountSent || 0), 0)
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

    const incomeTotals = sumByMonth(rangeIncome.data)
    const expenseTotals = sumByMonth(rangeExpenses.data)
    const transferTotals = sumByMonth(rangeTransfers.data, (r) => r.amountSent)

    return months.map(({ key, label }) => {
      const income = incomeTotals[key] || 0
      const expenses = expenseTotals[key] || 0
      const transfers = transferTotals[key] || 0
      const savingsRate = income ? (income - expenses - transfers) / income : null
      return { month: label, income, expenses, transfers, savingsRate }
    })
  }, [rangeIncome.data, rangeExpenses.data, rangeTransfers.data])

  const noExpensesThisMonth = !monthExpenses.loading && pieExpenses.length === 0

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <ChartCard title="🗓️ Year in review" className="lg:col-span-2">
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
        <div className="flex rounded-full border border-gray-200 bg-white p-1 dark:border-white/5 dark:bg-neutral-900 lg:col-span-2 lg:max-w-sm">
          <CountryToggleButton active={pieCountry === 'JP'} onClick={() => setPieCountry('JP')}>
            🇯🇵 Japan
          </CountryToggleButton>
          <CountryToggleButton active={pieCountry === 'IN'} onClick={() => setPieCountry('IN')}>
            🇮🇳 India
          </CountryToggleButton>
        </div>
      )}

      <ChartCard title={`Spend by category (this month${hasInExpenses ? `, ${pieCountry === 'IN' ? 'India' : 'Japan'}` : ''})`}>
        {noExpensesThisMonth ? (
          <EmptyState />
        ) : (
          <RankedBars data={byCategory} formatter={pieFormatter} icons={CATEGORY_ICONS} />
        )}
      </ChartCard>

      <ChartCard title={`Spend by payment method (this month${hasInExpenses ? `, ${pieCountry === 'IN' ? 'India' : 'Japan'}` : ''})`}>
        {noExpensesThisMonth ? (
          <EmptyState />
        ) : (
          <RankedBars data={byPaymentMethod} formatter={pieFormatter} />
        )}
      </ChartCard>

      <ChartCard
        title={`No-spend heatmap (this month${hasInExpenses ? `, ${pieCountry === 'IN' ? 'India' : 'Japan'}` : ''})`}
        className="lg:col-span-2"
      >
        <SpendHeatmap expenses={pieExpenses} formatter={pieFormatter} />
      </ChartCard>

      <ChartCard title="Income vs expenses vs transfers (last 6 months)" className="lg:col-span-2">
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
      </ChartCard>

      <ChartCard title="Savings rate trend" className="lg:col-span-2">
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
      </ChartCard>
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
          : 'text-gray-500 dark:text-gray-400'
      }`}
    >
      {children}
    </button>
  )
}

function EmptyState() {
  return (
    <p className="text-sm text-gray-500 text-center py-16 dark:text-gray-400">
      No expenses yet this month
    </p>
  )
}

function YearStat({ label, value, icon, positive }) {
  const colorClass =
    positive === undefined
      ? 'text-gray-900 dark:text-gray-100'
      : positive
        ? 'text-green-600 dark:text-green-400'
        : 'text-red-500 dark:text-red-400'
  return (
    <div className="rounded-2xl bg-gray-50 p-3 dark:bg-neutral-800/50">
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      </div>
      <p className={`text-sm font-bold mt-1 ${colorClass}`}>{value}</p>
    </div>
  )
}
