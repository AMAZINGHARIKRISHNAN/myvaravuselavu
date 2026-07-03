import { useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { CATEGORIES, COUNTRIES } from '../lib/constants'
import { formatJPY, formatByCountry, toDate } from '../lib/format'
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
    <div className="space-y-4 pb-16">
      <div className="flex gap-2">
        <TabButton active={tab === 'expenses'} onClick={() => setTab('expenses')}>
          Expenses
        </TabButton>
        <TabButton active={tab === 'income'} onClick={() => setTab('income')}>
          Income
        </TabButton>
      </div>

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">🔍</span>
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
          onAdd={tab === 'expenses' ? expenses.add : income.add}
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
        {records.map((record) => (
          <div
            key={record.id}
            className="card p-4 flex items-center justify-between animate-[toast-in_0.15s_ease-out]"
          >
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {tab === 'expenses' ? formatByCountry(record.amount, record.country) : formatJPY(record.amount)}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {toDate(record.date)?.toLocaleDateString()}
                {tab === 'expenses'
                  ? ` · ${record.category} · ${record.paymentMethod || '—'} · ${record.country}`
                  : ` · ${record.source}`}
              </p>
              {record.note && (
                <p className="text-xs text-gray-400 mt-0.5 dark:text-gray-500">{record.note}</p>
              )}
            </div>
            <div className="flex gap-3 text-xs font-medium">
              <button
                type="button"
                onClick={() => setEditing(record)}
                className="text-indigo-600 dark:text-fuchsia-400"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => activeUndo.requestDelete(record.id)}
                className="text-red-500 dark:text-red-400"
              >
                Delete
              </button>
            </div>
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
