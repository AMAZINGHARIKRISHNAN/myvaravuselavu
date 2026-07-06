import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Search, Pencil, Trash2, Banknote } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { CATEGORIES, CATEGORY_ICONS, COUNTRIES } from '../lib/constants'
import { formatJPY, formatINR, formatByCountry, toDateInputValue, parseDateInput } from '../lib/format'
import { downloadCsv, formatDateForCsv } from '../lib/csv'
import EntryFlow from '../components/entry/EntryFlow'
import IncomeForm from '../components/entry/IncomeForm'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'
import CsvImportButton from '../components/ui/CsvImportButton'
import FloatingActionButton from '../components/ui/FloatingActionButton'

const EMPTY = ''

export default function History() {
  const [tab, setTab] = useState('expenses')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [category, setCategory] = useState(EMPTY)
  const [country, setCountry] = useState(EMPTY)
  const [paymentMethod, setPaymentMethod] = useState(EMPTY)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [addingIncome, setAddingIncome] = useState(false)
  const [addingExpense, setAddingExpense] = useState(false)

  const dateRange = useMemo(() => {
    if (!start && !end) return undefined
    return {
      start: start ? new Date(`${start}T00:00:00`) : undefined,
      end: end ? new Date(`${end}T23:59:59`) : undefined,
    }
  }, [start, end])

  const expenses = useCollection('expenses', { dateRange })
  const income = useCollection('income', { dateRange })
  const expensesUndo = useUndoableDelete(expenses.remove, 'Expense')
  const incomeUndo = useUndoableDelete(income.remove, 'Income')

  const paymentMethods = useMemo(() => {
    const set = new Set(expenses.data.map((e) => e.paymentMethod).filter(Boolean))
    return Array.from(set)
  }, [expenses.data])

  const searchLower = search.trim().toLowerCase()

  const filteredExpenses = expenses.data.filter((e) => {
    if (expensesUndo.pendingIds.has(e.id)) return false
    if (category && e.category !== category) return false
    if (country && e.country !== country) return false
    if (paymentMethod && e.paymentMethod !== paymentMethod) return false
    if (searchLower && !e.note?.toLowerCase().includes(searchLower)) return false
    return true
  })

  const filteredIncome = income.data.filter((r) => {
    if (incomeUndo.pendingIds.has(r.id)) return false
    if (searchLower && !r.note?.toLowerCase().includes(searchLower) && !r.source?.toLowerCase().includes(searchLower))
      return false
    return true
  })

  const records = tab === 'expenses' ? filteredExpenses : filteredIncome
  const loading = tab === 'expenses' ? expenses.loading : income.loading
  const activeUndo = tab === 'expenses' ? expensesUndo : incomeUndo

  // Group records (already sorted date-desc) by local day, with per-day totals.
  // JP and IN expenses are different currencies, so day totals keep them apart.
  const dayGroups = (() => {
    const map = new Map()
    for (const record of records) {
      const key = toDateInputValue(record.date)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(record)
    }
    return [...map.entries()].map(([key, recs]) => {
      const isExpenses = tab === 'expenses'
      const jpy = recs.reduce(
        (sum, r) => sum + (isExpenses && r.country === 'IN' ? 0 : r.amount || 0),
        0
      )
      const inr = isExpenses
        ? recs.reduce((sum, r) => sum + (r.country === 'IN' ? r.amount || 0 : 0), 0)
        : 0
      const totalLabel = [jpy > 0 ? formatJPY(jpy) : null, inr > 0 ? formatINR(inr) : null]
        .filter(Boolean)
        .join(' · ')
      return { key, records: recs, label: format(parseDateInput(key), 'EEE, d MMM yyyy'), totalLabel }
    })
  })()

  const handleExport = () => {
    if (tab === 'expenses') {
      downloadCsv(
        'expenses.csv',
        filteredExpenses,
        [
          { label: 'Date', value: formatDateForCsv },
          { label: 'Amount', value: (r) => r.amount },
          { label: 'Category', value: (r) => r.category },
          { label: 'Country', value: (r) => r.country },
          { label: 'Payment Method', value: (r) => r.paymentMethod },
          { label: 'Note', value: (r) => r.note },
        ]
      )
    } else {
      downloadCsv(
        'income.csv',
        filteredIncome,
        [
          { label: 'Date', value: formatDateForCsv },
          { label: 'Amount', value: (r) => r.amount },
          { label: 'Source', value: (r) => r.source },
          { label: 'Gross', value: (r) => r.gross },
          { label: 'Net', value: (r) => r.net },
          { label: 'Note', value: (r) => r.note },
        ]
      )
    }
  }

  return (
    <div className="space-y-4 pb-16 lg:mx-auto lg:max-w-3xl lg:pb-0">
      <div className="flex rounded-full border border-gray-200 bg-white p-1 dark:border-white/5 dark:bg-neutral-900">
        <TabButton active={tab === 'expenses'} onClick={() => setTab('expenses')}>
          Expenses
        </TabButton>
        <TabButton active={tab === 'income'} onClick={() => setTab('income')}>
          Income
        </TabButton>
      </div>

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
          <Search size={15} aria-hidden="true" />
        </span>
        <input
          type="text"
          placeholder="Search notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-9"
        />
      </div>

      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-500 space-y-1 block dark:text-gray-400">
            From
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input" />
          </label>
          <label className="text-xs text-gray-500 space-y-1 block dark:text-gray-400">
            To
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input" />
          </label>
        </div>

        {tab === 'expenses' && (
          <div className="grid grid-cols-3 gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="input">
              <option value="">All countries</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="input"
            >
              <option value="">All methods</option>
              {paymentMethods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}

        <button type="button" onClick={handleExport} className="btn-ghost w-full py-2 text-xs">
          ⬇ Export CSV
        </button>
        <CsvImportButton
          mapRow={
            tab === 'expenses'
              ? (row) => {
                  const amount = parseFloat(row.Amount)
                  if (!amount || !row.Date) return null
                  return {
                    amount,
                    category: row.Category || 'Other',
                    country: row.Country || 'JP',
                    paymentMethod: row['Payment Method'] || 'Cash',
                    note: row.Note || '',
                    date: new Date(row.Date),
                  }
                }
              : (row) => {
                  const amount = parseFloat(row.Amount)
                  if (!amount || !row.Date) return null
                  return {
                    amount,
                    source: row.Source || 'Salary',
                    gross: row.Gross ? parseFloat(row.Gross) : null,
                    net: row.Net ? parseFloat(row.Net) : null,
                    note: row.Note || '',
                    date: new Date(row.Date),
                  }
                }
          }
          onImport={tab === 'expenses' ? expenses.addMany : income.addMany}
        />
      </div>

      <div className="space-y-2">
        {loading && (
          <>
            <Skeleton className="h-[68px] w-full" />
            <Skeleton className="h-[68px] w-full" />
            <Skeleton className="h-[68px] w-full" />
          </>
        )}
        {!loading && records.length === 0 && (
          <EmptyState icon="🗂️" message="No records match" />
        )}
        {dayGroups.map((group) => (
          <div key={group.key} className="space-y-2">
            <div className="flex items-baseline justify-between px-1 pt-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{group.label}</p>
              {group.totalLabel && (
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{group.totalLabel}</p>
              )}
            </div>
            {group.records.map((record) => (
              <div
                key={record.id}
                className="card p-3 pl-4 flex items-center gap-3 animate-[toast-in_0.15s_ease-out]"
              >
                {tab === 'expenses' ? (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-base dark:bg-neutral-800">
                    {CATEGORY_ICONS[record.category] || '📌'}
                  </span>
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                    <Banknote size={16} aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {tab === 'expenses' ? formatByCountry(record.amount, record.country) : formatJPY(record.amount)}
                  </p>
                  <p className="text-xs text-gray-500 truncate dark:text-gray-400">
                    {tab === 'expenses'
                      ? `${record.category} · ${record.paymentMethod || '—'} · ${record.country}`
                      : record.source}
                    {record.note && ` · ${record.note}`}
                  </p>
                </div>
                <div className="flex shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditing(record)}
                    aria-label="Edit"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition-all hover:text-indigo-600 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-indigo-400"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => activeUndo.requestDelete(record.id)}
                    aria-label="Delete"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-red-400"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <FloatingActionButton
        label={tab === 'expenses' ? 'Add expense' : 'Add income'}
        onClick={() => (tab === 'expenses' ? setAddingExpense(true) : setAddingIncome(true))}
      />

      {editing && tab === 'expenses' && (
        <EntryFlow initial={editing} onClose={() => setEditing(null)} />
      )}
      {editing && tab === 'income' && <IncomeForm initial={editing} onClose={() => setEditing(null)} />}
      {addingIncome && <IncomeForm onClose={() => setAddingIncome(false)} />}
      {addingExpense && <EntryFlow onClose={() => setAddingExpense(false)} />}
    </div>
  )
}

function TabButton({ active, onClick, children }) {
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
