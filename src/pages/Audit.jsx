import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useCollectionWriters } from '../hooks/useCollectionWriters'
import { useAccountBalances } from '../hooks/useAccountBalances'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../context/ToastContext'
import { monthRange } from '../lib/dateRanges'
import { formatJPY } from '../lib/format'
import { COMMON_BILLS, billsTotal, billsToLog } from '../lib/audit'
import { monthTotals } from '../lib/money'
import Skeleton from '../components/ui/Skeleton'
import { useToday } from '../hooks/useToday'

// Close the month: total everything, log the bills that vary month to month,
// then reconcile every account against reality and log whatever's missing —
// so the books are signed off and cross-checked.
export default function Audit() {
  const { balances, loading: balancesLoading } = useAccountBalances()
  const { settings, save } = useSettings()
  const { toast } = useToast()
  const { add: addExpense } = useCollectionWriters('expenses')
  const { add: addAudit } = useCollectionWriters('monthAudits')
  const audits = useCollection('monthAudits')

  // Default to LAST month — you audit a month once it's over.
  const [offset, setOffset] = useState(1)
  const today = useToday()
  const range = useMemo(() => monthRange(offset, today), [offset, today])
  const monthEnd = useMemo(() => range.end || new Date(), [range])

  const income = useCollection('income', { dateRange: range })
  const expenses = useCollection('expenses', { dateRange: range })
  const transfers = useCollection('transfers', { dateRange: range })

  const accounts = settings?.accounts || []
  const jpAccounts = accounts.filter((a) => (a.country || 'JP') === 'JP')

  const totals = useMemo(
    () => monthTotals({ income: income.data, expenses: expenses.data, transfers: transfers.data }),
    [income.data, expenses.data, transfers.data]
  )

  const alreadyAudited = audits.data.some((a) => a.monthKey === range.key)
  // Pre-tick the bills you had last time, so the recurring ones are one glance.
  const lastBillKeys = useMemo(() => {
    const prev = [...audits.data].sort((a, b) => (b.monthKey || '').localeCompare(a.monthKey || ''))[0]
    return new Set(prev?.billKeys || [])
  }, [audits.data])

  // ---- Bills checklist ----
  const [bills, setBills] = useState(null) // lazy-init from lastBillKeys
  const billRows =
    bills ??
    COMMON_BILLS.map((b) => ({ ...b, checked: lastBillKeys.has(b.key), amount: '' }))
  const setBill = (key, patch) =>
    setBills(billRows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const [billsPaidFrom, setBillsPaidFrom] = useState('')
  const paidFrom = billsPaidFrom || jpAccounts[0]?.label || 'Cash'
  const [loggingBills, setLoggingBills] = useState(false)

  const toLog = billsToLog(billRows)
  const logBills = async () => {
    if (toLog.length === 0) return
    setLoggingBills(true)
    try {
      for (const b of toLog) {
        await addExpense({
          amount: b.amount,
          category: 'Bills',
          country: 'JP',
          paymentMethod: paidFrom,
          store: b.label,
          note: `${range.label} bill`,
          date: monthEnd,
        })
      }
      // Untick what we just logged so it can't be double-posted.
      setBills(billRows.map((r) => (r.checked ? { ...r, checked: false, amount: '' } : r)))
      toast(`🧾 ${toLog.length} bill${toLog.length === 1 ? '' : 's'} logged · ${formatJPY(billsTotal(billRows))}`)
    } finally {
      setLoggingBills(false)
    }
  }

  const [closing, setClosing] = useState(false)
  const closeMonth = async () => {
    setClosing(true)
    try {
      await addAudit({
        monthKey: range.key,
        label: range.label,
        income: totals.income,
        expenses: totals.expenses,
        transfers: totals.transfers,
        saved: totals.saved,
        billKeys: billRows.filter((r) => r.checked).map((r) => r.key),
        billsTotal: billsTotal(billRows),
        balances: balances.map((b) => ({ label: b.label, country: b.country, balance: b.balance })),
        date: monthEnd,
      })
      await save({ lastAuditedMonth: range.key })
      toast(`✅ ${range.label} audited and recorded`)
    } finally {
      setClosing(false)
    }
  }

  const loading = balancesLoading || income.loading || expenses.loading || transfers.loading

  return (
    <div className="space-y-4 pb-16 lg:mx-auto lg:max-w-2xl lg:pb-0">
      {/* ---- Month picker + status ---- */}
      <div className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOffset((o) => o + 1)}
            className="flex tap-target h-9 w-9 items-center justify-center rounded-full border border-gray-300/60 bg-gray-100 text-gray-500 active:scale-90 dark:border-transparent dark:bg-neutral-800 dark:text-gray-400"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="text-center">
            <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              🧮 Month-end audit
            </h1>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{range.label}</p>
          </div>
          <button
            type="button"
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
            disabled={offset === 0}
            className="flex tap-target h-9 w-9 items-center justify-center rounded-full border border-gray-300/60 bg-gray-100 text-gray-500 active:scale-90 disabled:opacity-40 dark:border-transparent dark:bg-neutral-800 dark:text-gray-400"
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        {alreadyAudited && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <Check size={12} /> Already audited — re-run to adjust
          </p>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {/* ---- What you did this month ---- */}
          <div className="card p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Everything this month
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: '💰 Income', value: totals.income, tone: 'in' },
                { label: '🧾 Expenses', value: totals.expenses, tone: 'out' },
                { label: '💸 Sent home', value: totals.transfers, tone: 'out' },
                { label: '📈 Saved', value: totals.saved, tone: totals.saved >= 0 ? 'in' : 'out' },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-gray-100/80 px-3 py-2.5 dark:bg-neutral-800/50">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                  <p
                    className={`text-base font-bold tabular-nums ${
                      s.tone === 'in'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    {formatJPY(s.value)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ---- Bills checklist ---- */}
          <div className="card p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                This month's bills
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Tick what you paid and type the amount — combined some months, separate others.
              </p>
            </div>

            <div className="space-y-1.5">
              {billRows.map((r) => (
                <div key={r.key} className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setBill(r.key, { checked: !r.checked })}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-sm font-bold transition-transform active:scale-90 touch-manipulation ${
                      r.checked
                        ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                        : 'border-gray-300 dark:border-neutral-600'
                    }`}
                    aria-label={r.checked ? `Untick ${r.label}` : `Tick ${r.label}`}
                  >
                    {r.checked ? '✓' : ''}
                  </button>
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      r.checked ? 'text-gray-800 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {r.emoji} {r.label}
                  </span>
                  {r.checked && (
                    <input
                      type="number"
                      step="any"
                      inputMode="numeric"
                      placeholder="¥"
                      value={r.amount}
                      onChange={(e) => setBill(r.key, { amount: e.target.value })}
                      className="input w-24 shrink-0 text-right tabular-nums"
                    />
                  )}
                </div>
              ))}
            </div>

            {toLog.length > 0 && (
              <>
                {jpAccounts.length > 0 && (
                  <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
                    Paid from
                    <select
                      value={paidFrom}
                      onChange={(e) => setBillsPaidFrom(e.target.value)}
                      className="input"
                    >
                      {jpAccounts.map((a) => (
                        <option key={a.id} value={a.label}>
                          {a.label}
                        </option>
                      ))}
                      <option value="Cash">Cash</option>
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  disabled={loggingBills}
                  onClick={logBills}
                  className="btn-primary min-h-11 w-full text-sm"
                >
                  {loggingBills
                    ? 'Logging…'
                    : `Log ${toLog.length} bill${toLog.length === 1 ? '' : 's'} · ${formatJPY(billsTotal(billRows))}`}
                </button>
              </>
            )}
          </div>

          {/* ---- Cross-check balances: the itemised flow lives on its own
               page, so a gap gets explained line by line instead of being
               dumped into a single "Other" expense. ---- */}
          <Link to="/reconcile" className="card block p-4 space-y-1 transition-transform active:scale-[0.99] touch-manipulation">
            <h2 className="flex items-center justify-between text-sm font-semibold text-gray-900 dark:text-gray-100">
              Cross-check balances
              <ChevronRight size={15} className="text-gray-400" aria-hidden="true" />
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Type what each account and your cash really hold, then log where any difference went —
              date by date, with cash you withdrew landing in your cash on hand.
            </p>
          </Link>

          {/* ---- Sign off ---- */}
          <button
            type="button"
            disabled={closing}
            onClick={closeMonth}
            className="btn-primary min-h-12 w-full text-sm"
          >
            {closing ? 'Recording…' : `✅ Close & record ${range.label}`}
          </button>
          <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
            Saves a permanent snapshot of this month's totals and balances.
          </p>
        </>
      )}
    </div>
  )
}
