import { useMemo, useState } from 'react'
import { startOfMonth, differenceInCalendarMonths, format } from 'date-fns'
import { useCollection } from '../hooks/useCollection'
import { useSettings } from '../hooks/useSettings'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { useLiveRate } from '../hooks/useLiveRate'
import { formatJPY, formatINR, formatPercent, toDate } from '../lib/format'
import { downloadCsv, formatDateForCsv } from '../lib/csv'
import TransferForm from '../components/entry/TransferForm'
import CsvImportButton from '../components/ui/CsvImportButton'
import CollapsibleSection from '../components/ui/CollapsibleSection'
import FloatingActionButton from '../components/ui/FloatingActionButton'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'

export default function Transfers() {
  const { settings, loading: settingsLoading, save } = useSettings()
  const joinDate = useMemo(() => toDate(settings?.joinDate), [settings?.joinDate])

  // Load everything since the join month (falls back to all-time if unset).
  const journeyRange = useMemo(
    () => (joinDate ? { start: startOfMonth(joinDate) } : undefined),
    [joinDate]
  )
  const { data: rawTransfers, loading, add, remove } = useCollection('transfers', { dateRange: journeyRange })
  const { data: income } = useCollection('income', { dateRange: journeyRange })
  const { pendingIds, requestDelete } = useUndoableDelete(remove, 'Transfer')
  const data = useMemo(() => rawTransfers.filter((t) => !pendingIds.has(t.id)), [rawTransfers, pendingIds])
  const { rate: liveRate } = useLiveRate()
  const pageLoading = loading || settingsLoading

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [recipientFilter, setRecipientFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')

  const now = new Date()

  // Journey totals (everything since joining the company).
  const salaryEarned = income.reduce((sum, i) => sum + (i.net ?? i.amount ?? 0), 0)
  const sentAllTime = data.reduce((sum, t) => sum + (t.amountSent || 0), 0)
  const receivedAllTime = data.reduce((sum, t) => sum + (t.amountReceived || 0), 0)
  const saved = salaryEarned - sentAllTime
  const sentPct = salaryEarned > 0 ? sentAllTime / salaryEarned : 0
  const months = joinDate ? differenceInCalendarMonths(now, joinDate) + 1 : 0
  const avgHistoricalRate = data.length
    ? data.reduce((sum, t) => sum + (t.exchangeRate || 0), 0) / data.length
    : 0

  // "This year" cards, derived from the same data client-side.
  const thisYear = data.filter((t) => toDate(t.date)?.getFullYear() === now.getFullYear())
  const totalSent = thisYear.reduce((sum, t) => sum + (t.amountSent || 0), 0)
  const totalReceived = thisYear.reduce((sum, t) => sum + (t.amountReceived || 0), 0)
  const totalFees = thisYear.reduce((sum, t) => sum + (t.fee || 0), 0)
  const avgRate = thisYear.length
    ? thisYear.reduce((sum, t) => sum + (t.exchangeRate || 0), 0) / thisYear.length
    : 0

  const methodStats = useMemo(() => {
    const map = {}
    for (const t of data) {
      const key = t.method || 'Other'
      if (!map[key]) map[key] = { sent: 0, received: 0, fee: 0, count: 0 }
      map[key].sent += t.amountSent || 0
      map[key].received += t.amountReceived || 0
      map[key].fee += t.fee || 0
      map[key].count += 1
    }
    return Object.entries(map)
      .map(([method, s]) => ({
        method,
        count: s.count,
        avgFee: s.fee / s.count,
        effectiveRate: s.sent > 0 ? s.received / s.sent : 0,
      }))
      .sort((a, b) => b.effectiveRate - a.effectiveRate)
  }, [data])

  const recipientStats = useMemo(() => {
    const map = {}
    for (const t of data) {
      const key = t.recipient || 'Unknown'
      if (!map[key]) map[key] = { sent: 0, received: 0 }
      map[key].sent += t.amountSent || 0
      map[key].received += t.amountReceived || 0
    }
    return Object.entries(map)
      .map(([recipient, s]) => ({ recipient, ...s }))
      .sort((a, b) => b.sent - a.sent)
  }, [data])

  const recipients = useMemo(
    () => Array.from(new Set(data.map((t) => t.recipient).filter(Boolean))),
    [data]
  )
  const methods = useMemo(
    () => Array.from(new Set(data.map((t) => t.method).filter(Boolean))),
    [data]
  )

  const searchLower = search.trim().toLowerCase()
  const filteredList = data.filter((t) => {
    if (recipientFilter && t.recipient !== recipientFilter) return false
    if (methodFilter && t.method !== methodFilter) return false
    if (searchLower && !t.note?.toLowerCase().includes(searchLower)) return false
    return true
  })

  const handleExport = () => {
    downloadCsv(
      'transfers.csv',
      filteredList,
      [
        { label: 'Date', value: formatDateForCsv },
        { label: 'Amount Sent', value: (r) => r.amountSent },
        { label: 'Amount Received', value: (r) => r.amountReceived },
        { label: 'Exchange Rate', value: (r) => r.exchangeRate },
        { label: 'Fee', value: (r) => r.fee },
        { label: 'Recipient', value: (r) => r.recipient },
        { label: 'Method', value: (r) => r.method },
        { label: 'Note', value: (r) => r.note },
      ]
    )
  }

  const importMapRow = (row) => {
    const sent = parseFloat(row['Amount Sent'])
    const received = parseFloat(row['Amount Received'])
    if (!sent || !received || !row.Date) return null
    return {
      amountSent: sent,
      amountReceived: received,
      exchangeRate: parseFloat(row['Exchange Rate']) || received / sent,
      fee: parseFloat(row.Fee) || 0,
      date: new Date(row.Date),
      recipient: row.Recipient || 'Parents',
      method: row.Method || 'Wise',
      note: row.Note || '',
    }
  }

  const insightsSubtitle = `${formatJPY(totalSent)} sent this year · avg rate ${avgRate ? avgRate.toFixed(3) : '—'}`

  return (
    <div className="space-y-6 pb-16">
      {pageLoading ? (
        <>
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-20 w-full" />
        </>
      ) : (
        <>
          <JourneyCard
            joinDate={joinDate}
            months={months}
            salaryEarned={salaryEarned}
            sentAllTime={sentAllTime}
            receivedAllTime={receivedAllTime}
            saved={saved}
            sentPct={sentPct}
            onSaveJoinDate={(d) => save({ joinDate: d })}
          />

          <LiveRateCard liveRate={liveRate} avgHistoricalRate={avgHistoricalRate} />
        </>
      )}

      <div className="card p-4 space-y-3">
        <input
          type="text"
          placeholder="Search notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
        />
        {(recipients.length > 1 || methods.length > 1) && (
          <div className="grid grid-cols-2 gap-2">
            <select value={recipientFilter} onChange={(e) => setRecipientFilter(e.target.value)} className="input">
              <option value="">All recipients</option>
              {recipients.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className="input">
              <option value="">All methods</option>
              {methods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={handleExport} className="btn-ghost py-2 text-xs">
            ⬇ Export CSV
          </button>
          <CsvImportButton mapRow={importMapRow} onAdd={add} />
        </div>
      </div>

      <div className="space-y-2">
        {loading && (
          <>
            <Skeleton className="h-[72px] w-full" />
            <Skeleton className="h-[72px] w-full" />
          </>
        )}
        {!loading && filteredList.length === 0 && (
          <EmptyState icon="💸" message="No transfers match — send your first one to family" />
        )}
        {filteredList.map((t) => (
          <div key={t.id} className="card p-4 flex items-center justify-between animate-[toast-in_0.15s_ease-out]">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {formatJPY(t.amountSent)} → {formatINR(t.amountReceived)}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {toDate(t.date)?.toLocaleDateString()} · {t.method} · {t.recipient}
              </p>
              {t.note && <p className="text-xs text-gray-400 mt-0.5 dark:text-gray-500">{t.note}</p>}
            </div>
            <div className="flex gap-3 text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  setEditing(t)
                  setShowForm(true)
                }}
                className="text-indigo-600 dark:text-fuchsia-400"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => requestDelete(t.id)}
                className="text-red-500 dark:text-red-400"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {!pageLoading && (
        <CollapsibleSection icon="📊" title="Insights" subtitle={insightsSubtitle}>
          {settings?.familyGoalTarget > 0 && (
            <FamilyGoalCard
              label={settings.familyGoalLabel || 'Family goal'}
              target={settings.familyGoalTarget}
              received={receivedAllTime}
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <SummaryCard label="Sent this year (JPY)" value={formatJPY(totalSent)} icon="🚀" />
            <SummaryCard label="Received this year (INR)" value={formatINR(totalReceived)} icon="🎯" />
            <SummaryCard label="Avg. exchange rate" value={avgRate ? avgRate.toFixed(3) : '—'} icon="🔁" />
            <SummaryCard label="Total fees (JPY)" value={formatJPY(totalFees)} icon="🪙" />
          </div>

          {methodStats.length > 1 && <MethodComparisonCard methodStats={methodStats} />}

          {recipientStats.length > 1 && <RecipientBreakdownCard recipientStats={recipientStats} />}
        </CollapsibleSection>
      )}

      <FloatingActionButton
        label="Add transfer"
        onClick={() => {
          setEditing(null)
          setShowForm(true)
        }}
      />

      {showForm && <TransferForm initial={editing} onClose={() => setShowForm(false)} />}
    </div>
  )
}

function JourneyCard({
  joinDate,
  months,
  salaryEarned,
  sentAllTime,
  receivedAllTime,
  saved,
  sentPct,
  onSaveJoinDate,
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const startEdit = () => {
    setValue(joinDate ? format(joinDate, 'yyyy-MM-dd') : '')
    setEditing(true)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!value) return
    await onSaveJoinDate(new Date(value))
    setEditing(false)
  }

  if (!joinDate || editing) {
    return (
      <div className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🎌 Your journey</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          When did you join the company? We'll total your salary, what you've sent home, and what you've saved since then.
        </p>
        <form onSubmit={submit} className="flex gap-2">
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="input flex-1"
            required
          />
          <button type="submit" className="btn-primary px-4 text-sm">
            Save
          </button>
          {joinDate && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="btn-ghost px-3 text-sm"
            >
              Cancel
            </button>
          )}
        </form>
      </div>
    )
  }

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            🎌 Since {format(joinDate, 'MMM yyyy')}
          </h2>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {months} month{months === 1 ? '' : 's'} at the company
          </p>
        </div>
        <button
          type="button"
          onClick={startEdit}
          className="text-xs font-medium text-indigo-600 dark:text-fuchsia-400"
        >
          Edit date
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Salary earned" value={formatJPY(salaryEarned)} />
        <Stat label="Sent home" value={formatJPY(sentAllTime)} />
        <Stat
          label="Saved"
          value={formatJPY(saved)}
          className={saved < 0 ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'}
        />
      </div>

      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1 dark:text-gray-500">
          <span>{formatPercent(sentPct)} of salary sent home</span>
          <span>{formatINR(receivedAllTime)} received</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden dark:bg-neutral-800">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500"
            style={{ width: `${Math.min(100, Math.max(0, sentPct * 100))}%` }}
          />
        </div>
      </div>

      {salaryEarned === 0 && (
        <p className="text-xs text-gray-400 text-center dark:text-gray-500">
          Log your salary as income to see how much you've saved.
        </p>
      )}
    </div>
  )
}

function LiveRateCard({ liveRate, avgHistoricalRate }) {
  if (!liveRate) return null

  const hasBaseline = avgHistoricalRate > 0
  const diffPct = hasBaseline ? (liveRate - avgHistoricalRate) / avgHistoricalRate : 0
  const isGood = hasBaseline && diffPct >= 0.005
  const isBad = hasBaseline && diffPct <= -0.005

  return (
    <div className="card p-4 flex items-center justify-between transition-transform hover:-translate-y-0.5">
      <div>
        <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Live rate · JPY → INR</p>
        <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{liveRate.toFixed(3)}</p>
        {hasBaseline && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Your average: {avgHistoricalRate.toFixed(3)}
          </p>
        )}
      </div>
      {hasBaseline && (
        <span
          className={`text-xs font-semibold rounded-full px-2.5 py-1 ${
            isGood
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
              : isBad
                ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
                : 'bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-gray-400'
          }`}
        >
          {isGood ? '🟢 Good time to send' : isBad ? '🔴 Below your average' : '🟡 About average'}
        </span>
      )}
    </div>
  )
}

function FamilyGoalCard({ label, target, received }) {
  const progress = target > 0 ? received / target : 0
  return (
    <div className="card p-4 space-y-2 transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🏡 {label}</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {formatINR(received)} / {formatINR(target)}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden dark:bg-neutral-800">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500"
          style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
        />
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">{formatPercent(progress)} of goal</p>
    </div>
  )
}

function MethodComparisonCard({ methodStats }) {
  const best = methodStats[0]?.method
  return (
    <div className="card p-4 space-y-3 transition-transform hover:-translate-y-0.5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Method comparison</h2>
      <div className="space-y-2">
        {methodStats.map((m) => (
          <div key={m.method} className="flex items-center justify-between text-xs">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {m.method === best && '🏆 '}
              {m.method}
              <span className="text-gray-400 dark:text-gray-500"> · {m.count}x</span>
            </span>
            <span className="text-gray-400 dark:text-gray-500">
              {m.effectiveRate.toFixed(3)} eff. rate · avg fee {formatJPY(m.avgFee)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecipientBreakdownCard({ recipientStats }) {
  return (
    <div className="card p-4 space-y-3 transition-transform hover:-translate-y-0.5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">By recipient</h2>
      <div className="space-y-2">
        {recipientStats.map((r) => (
          <div key={r.recipient} className="flex items-center justify-between text-xs">
            <span className="font-medium text-gray-700 dark:text-gray-300">{r.recipient}</span>
            <span className="text-gray-400 dark:text-gray-500">
              {formatJPY(r.sent)} → {formatINR(r.received)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, className }) {
  return (
    <div>
      <p className={`text-sm font-bold text-gray-900 dark:text-gray-100 ${className || ''}`}>{value}</p>
      <p className="text-[11px] font-medium text-gray-400 mt-0.5 dark:text-gray-500">{label}</p>
    </div>
  )
}

function SummaryCard({ label, value, icon }) {
  return (
    <div className="card p-4 transition-transform hover:-translate-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-base">{icon}</span>
        <p className="text-xs font-medium text-gray-400 dark:text-gray-500">{label}</p>
      </div>
      <p className="text-lg font-bold text-gray-900 mt-1 dark:text-gray-100">{value}</p>
    </div>
  )
}
