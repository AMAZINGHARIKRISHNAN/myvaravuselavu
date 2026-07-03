import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts'
import { format } from 'date-fns'
import { useCollection } from '../hooks/useCollection'
import { currentMonthRange, lastNMonthsRange, currentYearRange } from '../lib/dateRanges'
import { formatJPY, formatINR, formatPercent, toDate } from '../lib/format'
import { useTheme } from '../context/ThemeContext'

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

function groupSum(records, keyFn, amountFn = (r) => r.amount) {
  const totals = {}
  for (const record of records) {
    const key = keyFn(record) || 'Unknown'
    totals[key] = (totals[key] || 0) + (amountFn(record) || 0)
  }
  return Object.entries(totals).map(([name, value]) => ({ name, value }))
}

function ChartCard({ title, children }) {
  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3 dark:text-gray-200">{title}</h2>
      {children}
    </div>
  )
}

export default function Charts() {
  const [pieCountry, setPieCountry] = useState('JP')
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const gridColor = isDark ? '#404040' : '#e5e7eb'
  const tickColor = isDark ? '#a3a3a3' : '#6b7280'
  const tooltipStyle = isDark
    ? { backgroundColor: '#171717', border: '1px solid #404040', borderRadius: 12, color: '#f3f4f6' }
    : { borderRadius: 12 }
  const legendColor = isDark ? '#d4d4d4' : '#374151'

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
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      months.push(format(d, 'yyyy-MM'))
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

    return months.map((key) => {
      const income = incomeTotals[key] || 0
      const expenses = expenseTotals[key] || 0
      const transfers = transferTotals[key] || 0
      const savingsRate = income ? (income - expenses - transfers) / income : null
      return {
        month: format(new Date(`${key}-01`), 'MMM'),
        income,
        expenses,
        transfers,
        savingsRate,
      }
    })
  }, [rangeIncome.data, rangeExpenses.data, rangeTransfers.data])

  const noExpensesThisMonth = !monthExpenses.loading && pieExpenses.length === 0

  return (
    <div className="space-y-4">
      <ChartCard title="🗓️ Year in review">
        <div className="grid grid-cols-2 gap-3">
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
        <div className="flex gap-2">
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
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={byCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                {byCategory.map((entry, i) => (
                  <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => pieFormatter(value)} contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ color: legendColor }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title={`Spend by payment method (this month${hasInExpenses ? `, ${pieCountry === 'IN' ? 'India' : 'Japan'}` : ''})`}>
        {noExpensesThisMonth ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={byPaymentMethod} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                {byPaymentMethod.map((entry, i) => (
                  <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => pieFormatter(value)} contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ color: legendColor }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Income vs expenses vs transfers (last 6 months)">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthlyTrend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
            <XAxis dataKey="month" fontSize={12} stroke={tickColor} />
            <YAxis fontSize={12} stroke={tickColor} />
            <Tooltip formatter={(value) => formatJPY(value)} contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ color: legendColor }} />
            <Bar dataKey="income" fill="#10b981" name="Income" radius={[6, 6, 0, 0]} />
            <Bar dataKey="expenses" fill="#f43f5e" name="Expenses" radius={[6, 6, 0, 0]} />
            <Bar dataKey="transfers" fill="#6366f1" name="Transfers" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Savings rate trend">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={monthlyTrend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
            <XAxis dataKey="month" fontSize={12} stroke={tickColor} />
            <YAxis fontSize={12} stroke={tickColor} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
            <Tooltip formatter={(value) => formatPercent(value)} contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="savingsRate" stroke="#d946ef" strokeWidth={3} dot={{ fill: '#d946ef', r: 4 }} />
          </LineChart>
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
      className={`flex-1 rounded-2xl py-2 text-sm font-medium transition-all active:scale-95 ${
        active
          ? 'bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-500/20'
          : 'bg-white border border-gray-200 text-gray-600 dark:bg-neutral-900 dark:border-neutral-800 dark:text-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

function EmptyState() {
  return (
    <p className="text-sm text-gray-400 text-center py-16 dark:text-gray-500">
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
        <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500">{label}</p>
      </div>
      <p className={`text-sm font-bold mt-1 ${colorClass}`}>{value}</p>
    </div>
  )
}
