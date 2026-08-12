import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { Search, Pencil, Trash2, Banknote, ChevronRight } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { buildActivityFeed } from '../lib/activity'
import { useCollectionWriters } from '../hooks/useCollectionWriters'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { CATEGORIES, CATEGORY_ICONS, COUNTRIES } from '../lib/constants'
import { formatJPY, formatINR, formatByCountry, toDateInputValue, parseDateInput } from '../lib/format'
import { downloadCsv, formatDateForCsv, parseCsvDate } from '../lib/csv'
import { normalizeStore, rankStores, storeKey } from '../lib/stores'
import { hasRoute, routeLabel } from '../lib/route'
import EntryFlow from '../components/entry/EntryFlow'
import MoveMoneySheet from '../components/entry/MoveMoneySheet'
import IncomeForm from '../components/entry/IncomeForm'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'
import CsvImportButton from '../components/ui/CsvImportButton'
import FloatingActionButton from '../components/ui/FloatingActionButton'
import SwipeableRow from '../components/ui/SwipeableRow'
import { countryOf } from '../lib/money'

const EMPTY = ''

export default function History() {
  const [tab, setTab] = useState('expenses')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [category, setCategory] = useState(EMPTY)
  const [country, setCountry] = useState(EMPTY)
  const [paymentMethod, setPaymentMethod] = useState(EMPTY)
  const [store, setStore] = useState(EMPTY)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  // Which editor to open. Used to be inferred from the active tab, so the
  // All tab — where `tab` is neither 'expenses' nor 'income' — rendered no
  // editor at all and the pencil was a dead tap.
  const [editKind, setEditKind] = useState(null)
  const openEditor = (record, kind) => {
    setEditing(record)
    setEditKind(kind)
  }
  const closeEditor = () => {
    setEditing(null)
    setEditKind(null)
  }
  const [addingIncome, setAddingIncome] = useState(false)
  const [addingExpense, setAddingExpense] = useState(false)
  // null = closed; an object = open, carrying whatever the entry flow
  // already knew (the amount typed on the keypad, the date chosen).
  const [showMove, setShowMove] = useState(null)
  // Date to stamp new entries with — for logging things after the fact (a trip
  // last week, a bill you forgot). Defaults to today.
  const [logDate, setLogDate] = useState(() => toDateInputValue(new Date()))

  const dateRange = useMemo(() => {
    if (!start && !end) return undefined
    return {
      start: start ? new Date(`${start}T00:00:00`) : undefined,
      end: end ? new Date(`${end}T23:59:59`) : undefined,
    }
  }, [start, end])

  const expenses = useCollection('expenses', { dateRange })
  const income = useCollection('income', { dateRange })
  // The "All activity" tab pulls from every collection. They only subscribe
  // while that tab is open, so the other two tabs cost nothing extra.
  const allEnabled = tab === 'all'
  const transfers = useCollection('transfers', { dateRange, enabled: allEnabled })
  const recharges = useCollection('pasmoRecharges', { dateRange, enabled: allEnabled })
  const withdrawals = useCollection('withdrawals', { dateRange, enabled: allEnabled })
  const officeItems = useCollection('officeReimbursements', { dateRange, enabled: allEnabled })
  const passes = useCollection('commutePasses', { dateRange, enabled: allEnabled })
  const friendPurchases = useCollection('friendPurchases', { dateRange, enabled: allEnabled })
  const orders = useCollection('onlineOrders', { dateRange, enabled: allEnabled })
  const windfalls = useCollection('windfalls', { dateRange, enabled: allEnabled })
  const cashCounts = useCollection('cashCounts', { dateRange, enabled: allEnabled })
  const accountEntries = useCollection('accountEntries', { dateRange, enabled: allEnabled })
  const { remove: removeGroupEntry } = useCollectionWriters('groupExpenses')
  const { remove: removeCommuteTrip } = useCollectionWriters('commuteTrips')
  const { update: updateOrder } = useCollectionWriters('onlineOrders')
  // Mirrored records carry their source along when deleted here, so no
  // feature is left pointing at a dead expense (which would make its next
  // edit fail) and no split/claim math counts phantom money.
  const removeExpenseSynced = async (id) => {
    const record = expenses.data.find((e) => e.id === id)
    await expenses.remove(id)
    try {
      if (record?.groupEntryId) await removeGroupEntry(record.groupEntryId)
      // A commute trip IS its expense — deleting one without the other
      // would leave a claimable trip whose money never existed.
      if (record?.commuteTripId) await removeCommuteTrip(record.commuteTripId)
      // Shopping orders stay (they hold return/points history) but drop the
      // dead link so a later edit recreates the mirror instead of crashing.
      if (record?.orderId) await updateOrder(record.orderId, { expenseId: null })
    } catch {
      // counterpart already gone — nothing left to sync
    }
  }
  const removeIncomeSynced = async (id) => {
    const record = income.data.find((e) => e.id === id)
    await income.remove(id)
    try {
      if (record?.groupEntryId) await removeGroupEntry(record.groupEntryId)
      // Deleted a refund income → the order's refund is unpaid again.
      if (record?.orderId) {
        await updateOrder(record.orderId, { refundIncomeId: null, refundStatus: 'pending' })
      }
    } catch {
      // counterpart already gone — nothing left to sync
    }
  }
  const expensesUndo = useUndoableDelete(removeExpenseSynced, 'Expense')
  const incomeUndo = useUndoableDelete(removeIncomeSynced, 'Income')

  const paymentMethods = useMemo(() => {
    const set = new Set(expenses.data.map((e) => e.paymentMethod).filter(Boolean))
    return Array.from(set)
  }, [expenses.data])

  // Shops seen in the loaded range, most-spent first, so the picker leads with
  // the places you actually go instead of an alphabet soup of one-offs.
  const storeOptions = useMemo(() => {
    const names = rankStores(expenses.data, { limit: Infinity }).map((s) => s.name)
    // Keep the active filter listed even when a narrowed date range no longer
    // contains it — otherwise the select goes blank while still filtering.
    return names.some((n) => storeKey(n) === storeKey(store)) || !store
      ? names
      : [store, ...names]
  }, [expenses.data, store])

  const searchLower = search.trim().toLowerCase()

  const filteredExpenses = expenses.data.filter((e) => {
    if (expensesUndo.pendingIds.has(e.id)) return false
    if (category && e.category !== category) return false
    if (country && e.country !== country) return false
    if (paymentMethod && e.paymentMethod !== paymentMethod) return false
    if (store && storeKey(e.store) !== storeKey(store)) return false
    if (
      searchLower &&
      !e.note?.toLowerCase().includes(searchLower) &&
      !e.store?.toLowerCase().includes(searchLower)
    )
      return false
    return true
  })

  const filteredIncome = income.data.filter((r) => {
    if (incomeUndo.pendingIds.has(r.id)) return false
    if (searchLower && !r.note?.toLowerCase().includes(searchLower) && !r.source?.toLowerCase().includes(searchLower))
      return false
    return true
  })

  const records = tab === 'expenses' ? filteredExpenses : filteredIncome
  const activeUndo = tab === 'expenses' ? expensesUndo : incomeUndo

  // ---- All-activity feed: every collection merged, newest first ----
  const activityFeed = useMemo(() => {
    if (tab !== 'all') return []
    return buildActivityFeed({
      expenses: expenses.data,
      income: income.data,
      transfers: transfers.data,
      recharges: recharges.data,
      withdrawals: withdrawals.data,
      officeItems: officeItems.data,
      passes: passes.data,
      friendPurchases: friendPurchases.data,
      orders: orders.data,
      windfalls: windfalls.data,
      cashCounts: cashCounts.data,
      accountEntries: accountEntries.data,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    expenses.data,
    income.data,
    transfers.data,
    recharges.data,
    withdrawals.data,
    officeItems.data,
    passes.data,
    friendPurchases.data,
    orders.data,
    windfalls.data,
    cashCounts.data,
    accountEntries.data,
  ])

  const activityFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return activityFeed
    return activityFeed.filter((r) => `${r.title} ${r.detail} ${r.kind}`.toLowerCase().includes(q))
  }, [activityFeed, search])

  const allLoading =
    tab === 'all' &&
    (expenses.loading ||
      income.loading ||
      transfers.loading ||
      recharges.loading ||
      withdrawals.loading ||
      officeItems.loading ||
      passes.loading ||
      friendPurchases.loading ||
      orders.loading ||
      windfalls.loading ||
      cashCounts.loading ||
      accountEntries.loading)

  const loading = tab === 'all' ? allLoading : tab === 'expenses' ? expenses.loading : income.loading

  // Group records (already sorted date-desc) by local day, with per-day totals.
  // JP and IN expenses are different currencies, so day totals keep them apart.
  const dayGroups = (() => {
    const source = tab === 'all' ? activityFiltered : records
    const map = new Map()
    for (const record of source) {
      const key = toDateInputValue(record.date)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(record)
    }
    return [...map.entries()].map(([key, recs]) => {
      if (tab === 'all') {
        return { key, records: recs, label: format(parseDateInput(key), 'EEE, d MMM yyyy'), totalLabel: '' }
      }
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
    if (tab === 'all') {
      downloadCsv(
        'all-activity.csv',
        activityFiltered,
        [
          { label: 'Date', value: (r) => formatDateForCsv(r) },
          { label: 'Type', value: (r) => r.kind },
          { label: 'What', value: (r) => r.title },
          { label: 'Detail', value: (r) => r.detail },
          { label: 'Direction', value: (r) => (r.tone === 'in' ? 'in' : r.tone === 'out' ? 'out' : 'move') },
          { label: 'Amount', value: (r) => r.amount },
          { label: 'Currency', value: (r) => (r.country === 'IN' ? 'INR' : 'JPY') },
        ]
      )
      return
    }
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
          { label: 'Store', value: (r) => r.store },
          { label: 'From', value: (r) => r.fromPlace },
          { label: 'To', value: (r) => r.toPlace },
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
      {/* Always-visible way into the month-end audit — no need to wait for the
          salary-day prompt. */}
      <Link
        to="/audit"
        className="card flex items-center gap-3 p-3.5 transition-transform active:scale-[0.99] touch-manipulation"
      >
        <span className="text-lg" aria-hidden="true">🧮</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
            Month-end audit
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Log bills, cross-check balances, catch anything missing
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
      </Link>

      {/* Log for any day — pick a date, then add. The entry saves on that date
          and shows up in its day group, wherever you happen to log it from. */}
      <div className="card p-4 space-y-2.5">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
          🗓️ Log for a specific day
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            className="input min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={() => setAddingExpense(true)}
            className="btn-primary min-h-10 shrink-0 px-3 text-xs"
          >
            ＋ Expense
          </button>
          <button
            type="button"
            onClick={() => setAddingIncome(true)}
            className="min-h-10 shrink-0 rounded-xl border border-gray-300/60 bg-gray-100 px-3 text-xs font-semibold text-gray-700 active:scale-95 dark:border-transparent dark:bg-neutral-800 dark:text-gray-200"
          >
            ＋ Income
          </button>
        </div>
      </div>

      <div className="flex rounded-full border border-gray-300/80 bg-white p-1 shadow-sm dark:border-white/5 dark:bg-neutral-900 dark:shadow-none">
        <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
          All
        </TabButton>
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
          placeholder={
            tab === 'all'
              ? 'Search all activity…'
              : tab === 'expenses'
                ? 'Search notes or stores…'
                : 'Search notes…'
          }
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
          // 2 columns on phones (3 side-by-side selects clip their labels);
          // the third spreads full-width below, back to one row on desktop.
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
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
              className="input col-span-2 lg:col-span-1"
            >
              <option value="">All methods</option>
              {paymentMethods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {storeOptions.length > 0 && (
              <select
                value={store}
                onChange={(e) => setStore(e.target.value)}
                className="input col-span-2 lg:col-span-3"
              >
                <option value="">All stores</option>
                {storeOptions.map((s) => (
                  <option key={s} value={s}>
                    🏪 {s}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <button type="button" onClick={handleExport} className="btn-ghost w-full py-2 text-xs">
          ⬇ Export CSV
        </button>
        {tab !== 'all' && (
        <CsvImportButton
          mapRow={
            tab === 'expenses'
              ? (row) => {
                  const amount = parseFloat(row.Amount)
                  const date = parseCsvDate(row.Date)
                  if (!amount || !date) return null
                  return {
                    amount,
                    category: row.Category || 'Other',
                    country: row.Country || 'JP',
                    paymentMethod: row['Payment Method'] || 'Cash',
                    store: normalizeStore(row.Store),
                    fromPlace: row.From || '',
                    toPlace: row.To || '',
                    note: row.Note || '',
                    date,
                  }
                }
              : (row) => {
                  const amount = parseFloat(row.Amount)
                  const date = parseCsvDate(row.Date)
                  if (!amount || !date) return null
                  return {
                    amount,
                    source: row.Source || 'Salary',
                    gross: row.Gross ? parseFloat(row.Gross) : null,
                    net: row.Net ? parseFloat(row.Net) : null,
                    note: row.Note || '',
                    date,
                  }
                }
          }
          onImport={tab === 'expenses' ? expenses.addMany : income.addMany}
        />
        )}
      </div>

      <div className="space-y-2">
        {loading && (
          <>
            <Skeleton className="h-[68px] w-full" />
            <Skeleton className="h-[68px] w-full" />
            <Skeleton className="h-[68px] w-full" />
          </>
        )}
        {!loading && tab === 'all' && activityFiltered.length === 0 && (
          <EmptyState icon="🗂️" message="No activity in this range" />
        )}
        {!loading && tab !== 'all' && records.length === 0 && (
          <EmptyState
            icon="🗂️"
            message="No records match"
            actionLabel={tab === 'expenses' ? '+ Add expense' : '+ Add income'}
            onAction={() => (tab === 'expenses' ? setAddingExpense(true) : setAddingIncome(true))}
          />
        )}

        {/* All-activity tab: one timeline over every collection. Expenses and
            income open their editor in place — they used to link to '/history',
            the page already on screen, so the tap did nothing. The rest still
            tap through to the screen that owns them. */}
        {tab === 'all' &&
          dayGroups.map((group) => (
            <div key={group.key} className="space-y-2">
              <p className="status-line px-1 pt-2 text-xs font-semibold text-gray-400">
                {group.label}
              </p>
              {group.records.map((r) => {
                // Expenses and income are edited right here; everything else
                // still taps through to the screen that owns it.
                const Row = r.edit ? 'button' : Link
                const rowProps = r.edit
                  ? { type: 'button', onClick: () => openEditor(r.record, r.edit) }
                  : { to: r.to }
                return (
                <Row
                  key={r.id}
                  {...rowProps}
                  // The feed already computes a tone for every row; under a HUD
                  // that becomes a stripe down the row's left edge, so the
                  // direction of money reads while scrolling without stopping
                  // to parse a sign. Ignored by flat skins.
                  data-tone={r.tone}
                  className="card flex w-full items-center gap-3 p-3 pl-4 text-left transition-transform active:scale-[0.99] touch-manipulation"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-base dark:bg-neutral-800">
                    {r.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {r.title}
                    </p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {r.kind}
                      {r.detail && ` · ${r.detail}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      r.tone === 'in'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : r.tone === 'out'
                          ? 'text-gray-900 dark:text-gray-100'
                          : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    {r.tone === 'in' ? '+' : r.tone === 'out' ? '−' : ''}
                    {formatByCountry(r.amount, r.country)}
                  </span>
                  {r.edit ? (
                    <Pencil size={14} className="shrink-0 text-gray-400" aria-hidden="true" />
                  ) : (
                    <ChevronRight size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
                  )}
                </Row>
                )
              })}
            </div>
          ))}

        {tab !== 'all' &&
          dayGroups.map((group) => (
          <div key={group.key} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 px-1 pt-2">
              {/* Grows rather than shrinks, so the status-line rule draws
                  across the gap between the date and the day's total. */}
              <p className="status-line min-w-0 flex-1 text-xs font-semibold text-gray-400">
                {group.label}
              </p>
              {group.totalLabel && (
                <p className="shrink-0 text-xs font-medium tabular-nums text-gray-400">
                  {group.totalLabel}
                </p>
              )}
            </div>
            {group.records.map((record) => (
              <SwipeableRow
                key={record.id}
                onEdit={() => openEditor(record, tab === 'expenses' ? 'expense' : 'income')}
                onDelete={() => activeUndo.requestDelete(record.id)}
              >
              <div
                data-tone={tab === 'expenses' ? 'out' : 'in'}
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
                    {tab === 'expenses' ? formatByCountry(record.amount, countryOf(record)) : formatJPY(record.amount)}
                  </p>
                  <p className="text-xs text-gray-500 truncate dark:text-gray-400">
                    {tab === 'expenses'
                      ? `${record.category} · ${record.paymentMethod || '—'} · ${countryOf(record)}`
                      : record.source}
                    {/* A journey shows its route; everything else its shop. */}
                    {hasRoute(record)
                      ? ` · 🚌 ${routeLabel(record.fromPlace, record.toPlace)}`
                      : record.store && ` · 🏪 ${record.store}`}
                    {record.friend && ` · 🤝 for ${record.friend}`}
                    {record.note && ` · ${record.note}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    onClick={() => openEditor(record, tab === 'expenses' ? 'expense' : 'income')}
                    aria-label="Edit"
                    className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-indigo-600 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-indigo-400"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => activeUndo.requestDelete(record.id)}
                    aria-label="Delete"
                    className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-red-400"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              </SwipeableRow>
            ))}
          </div>
        ))}
      </div>

      {/* The all-activity tab gets the button too: the entry sheet covers
          everything that shows up there — expenses, a split of one lump sum,
          a cash withdrawal, a card top-up, or a plain credit/debit. */}
      <FloatingActionButton
        label={tab === 'income' ? 'Add income' : 'Add entry'}
        onClick={() => (tab === 'income' ? setAddingIncome(true) : setAddingExpense(true))}
      />

      {editing && editKind === 'expense' && <EntryFlow initial={editing} onClose={closeEditor} />}
      {editing && editKind === 'income' && <IncomeForm initial={editing} onClose={closeEditor} />}
      {addingIncome && (
        <IncomeForm initialDate={parseDateInput(logDate)} onClose={() => setAddingIncome(false)} />
      )}
      {addingExpense && (
        <EntryFlow
          initialDate={parseDateInput(logDate)}
          onMoveMoney={(carried) => {
            setAddingExpense(false)
            setShowMove(carried || {})
          }}
          onClose={() => setAddingExpense(false)}
        />
      )}
      {showMove && <MoveMoneySheet initial={showMove} onClose={() => setShowMove(null)} />}
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
          : 'text-gray-600 dark:text-gray-400'
      }`}
    >
      {children}
    </button>
  )
}
