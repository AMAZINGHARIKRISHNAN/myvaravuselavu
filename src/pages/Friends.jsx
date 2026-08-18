import { useMemo, useState } from 'react'
import { HandCoins, Pencil, Trash2, CheckCircle2, ShoppingBag } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useCollectionWriters } from '../hooks/useCollectionWriters'
import { useSettings } from '../hooks/useSettings'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { formatByCountry, toDate } from '../lib/format'
import { downloadCsv, formatDateForCsv, parseCsvDate } from '../lib/csv'
import FriendPurchaseForm from '../components/entry/FriendPurchaseForm'
import CsvImportButton from '../components/ui/CsvImportButton'
import CollapsibleSection from '../components/ui/CollapsibleSection'
import FloatingActionButton from '../components/ui/FloatingActionButton'
import BottomSheet from '../components/ui/BottomSheet'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'
import SwipeableRow from '../components/ui/SwipeableRow'

// Settle + profit/loss rules live in lib/friendLedger so the Dashboard P/L
// card computes with exactly the same math as this page.
import { isSettled, cashPL, unfundedPurchases } from '../lib/friendLedger'

// Where the money physically landed when a friend pays you back. It's your own
// money returning, not income — so it moves a balance (a ➕ entry) and stays out
// of the income totals, while the profit/loss stays where it belongs: the
// friend ledger. "Not tracked" is honest for cash you don't count.
function DestinationPicker({ country, value, onChange }) {
  const { settings } = useSettings()
  const options = [
    ...(settings?.accounts || [])
      .filter((a) => (a.country || 'JP') === country)
      .map((a) => a.label),
    'Cash',
  ]
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-gray-500 dark:text-gray-400">Where did the money land?</p>
      <div className="flex flex-wrap gap-2">
        {[...options, ''].map((label) => (
          <button
            key={label || 'none'}
            type="button"
            onClick={() => onChange(label)}
            className={`min-h-9 rounded-full px-3.5 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
              value === label
                ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
            }`}
          >
            {label || 'Not tracked'}
          </button>
        ))}
      </div>
    </div>
  )
}

// Sums one currency group. "Realized" P/L counts only settled items (actual
// cash in hand vs. cash out of pocket); "expected" projects open items at
// their promised due amount on top of the realized number.
function computeTotals(items) {
  const t = { cost: 0, paid: 0, due: 0, received: 0, realized: 0, expected: 0, settledCount: 0 }
  for (const p of items) {
    const paid = p.paid ?? p.cost ?? 0
    t.cost += p.cost || 0
    t.paid += paid
    t.due += p.due || 0
    t.received += p.received || 0
    if (isSettled(p)) {
      // Done deal — count what actually happened.
      t.realized += cashPL(p)
      t.expected += cashPL(p)
      t.settledCount += 1
    } else {
      // Still open — assume the friend eventually pays the full due.
      t.expected += (p.due || 0) - paid
    }
  }
  return t
}

export default function Friends() {
  const { data: rawData, loading, addMany, update, remove } = useCollection('friendPurchases')
  // A repayment lands somewhere real; this is what moves that balance.
  const { add: addAccountEntry } = useCollectionWriters('accountEntries')
  const { pendingIds, requestDelete } = useUndoableDelete(remove, 'Purchase')
  const data = useMemo(() => rawData.filter((p) => !pendingIds.has(p.id)), [rawData, pendingIds])

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [paying, setPaying] = useState(null)
  // Group settle: which friend (name+currency) is settling everything at once
  const [groupSettling, setGroupSettling] = useState(null)
  const [search, setSearch] = useState('')
  const [friendFilter, setFriendFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const friendNames = useMemo(
    () => Array.from(new Set(data.map((p) => p.friend).filter(Boolean))).sort(),
    [data]
  )

  // Currency groups: JPY first, INR after if any items use it.
  const currencyGroups = useMemo(() => {
    const groups = []
    for (const country of ['JP', 'IN']) {
      const items = data.filter((p) => (p.country || 'JP') === country)
      if (items.length) groups.push({ country, totals: computeTotals(items) })
    }
    return groups
  }, [data])

  // Per-friend rollup (per currency): what they still owe, how many items are
  // open, and the realized cash profit/loss from items already settled.
  const friendStats = useMemo(() => {
    const map = {}
    for (const p of data) {
      const key = `${p.friend || 'Unknown'}|${p.country || 'JP'}`
      if (!map[key]) {
        map[key] = { friend: p.friend || 'Unknown', country: p.country || 'JP', due: 0, received: 0, cost: 0, open: 0, outstanding: 0, realized: 0 }
      }
      map[key].due += p.due || 0
      map[key].received += p.received || 0
      map[key].cost += p.cost || 0
      if (isSettled(p)) {
        map[key].realized += cashPL(p)
      } else {
        map[key].open += 1
        // Only open items count toward "still owes me" — closed shortfalls
        // are already booked as losses, not receivables.
        map[key].outstanding += Math.max(0, (p.due || 0) - (p.received || 0))
      }
    }
    return Object.values(map).sort((a, b) => b.outstanding - a.outstanding)
  }, [data])

  // The collect list: only friends who still owe money, biggest debt first —
  // this is the "who has to give me money and how much" view.
  const debtors = useMemo(() => friendStats.filter((f) => f.outstanding > 0), [friendStats])

  // Rows where money was recorded as owed but nothing recorded it leaving.
  // Reported, never touched: these are historical figures.
  const unfunded = useMemo(() => unfundedPurchases(data), [data])

  const searchLower = search.trim().toLowerCase()
  const filteredList = data.filter((p) => {
    if (friendFilter && p.friend !== friendFilter) return false
    if (statusFilter === 'open' && isSettled(p)) return false
    if (statusFilter === 'settled' && !isSettled(p)) return false
    if (
      searchLower &&
      !p.item?.toLowerCase().includes(searchLower) &&
      !p.note?.toLowerCase().includes(searchLower)
    )
      return false
    return true
  })

  const handleExport = () => {
    downloadCsv('friend-purchases.csv', filteredList, [
      { label: 'Date', value: formatDateForCsv },
      { label: 'Item', value: (r) => r.item },
      { label: 'Friend', value: (r) => r.friend },
      { label: 'Currency', value: (r) => r.country || 'JP' },
      { label: 'Cost', value: (r) => r.cost },
      { label: 'Paid', value: (r) => r.paid },
      { label: 'Due', value: (r) => r.due },
      { label: 'Received', value: (r) => r.received },
      { label: 'Closed', value: (r) => (r.closed ? 'yes' : '') }, // closed-as-final flag survives export/import
      { label: 'Note', value: (r) => r.note },
    ])
  }

  const importMapRow = (row) => {
    const cost = parseFloat(row.Cost)
    const date = parseCsvDate(row.Date)
    if (!cost || !row.Item || !date) return null
    return {
      item: row.Item,
      friend: row.Friend || 'Unknown',
      country: row.Currency === 'IN' ? 'IN' : 'JP',
      cost,
      paid: parseFloat(row.Paid) || cost,
      due: parseFloat(row.Due) || cost,
      received: parseFloat(row.Received) || 0,
      closed: row.Closed === 'yes', // restore the closed-as-final flag
      date,
      note: row.Note || '',
    }
  }

  const openCount = data.filter((p) => !isSettled(p)).length

  return (
    <div className="space-y-6 pb-16 lg:pb-0">
      {loading ? (
        <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          {currencyGroups.length === 0 ? (
            <div className="card p-4 space-y-1">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🤝 Friend ledger</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Bought something for a friend? Log it here to track what they owe you, what
                they've paid back, and any profit or loss on the deal.
              </p>
            </div>
          ) : (
            <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
              {currencyGroups.map(({ country, totals }) => (
                <LedgerSummaryCard key={country} country={country} totals={totals} openCount={openCount} />
              ))}
            </div>
          )}

          {/* Always-visible collect list: who has to give you money, and how
              much — sorted so the biggest debt is on top. */}
          {debtors.length > 0 && (
            <div className="card p-4 space-y-2.5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                💸 They have to give you
              </h2>
              {debtors.map((f) => (
                <div
                  key={`owes-${f.friend}|${f.country}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-100/80 px-3 py-2 dark:border-transparent dark:bg-neutral-800/50"
                >
                  <span className="min-w-0 text-sm font-medium text-gray-800 dark:text-gray-100">
                    {f.friend}
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      {' '}· {f.open} item{f.open === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {formatByCountry(f.outstanding, f.country)}
                    </span>
                    {/* One tap to settle every open item this friend has */}
                    <button
                      type="button"
                      onClick={() => setGroupSettling(f)}
                      className="rounded-full bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-transform active:scale-95 touch-manipulation dark:bg-indigo-500"
                    >
                      Settle
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {friendStats.length > 0 && (
            <CollapsibleSection
              icon="👥"
              title="By friend"
              subtitle={`${friendStats.length} friend${friendStats.length === 1 ? '' : 's'} · ${openCount} open item${openCount === 1 ? '' : 's'}`}
            >
              <div className="card p-4 space-y-2.5">
                {friendStats.map((f) => {
                  const outstanding = f.outstanding
                  return (
                    <div key={`${f.friend}|${f.country}`} className="flex items-center justify-between text-xs">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {f.friend}
                        {f.open > 0 && (
                          <span className="text-gray-500 dark:text-gray-400"> · {f.open} open</span>
                        )}
                        {f.realized !== 0 && (
                          <span
                            className={
                              f.realized > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-500 dark:text-red-400'
                            }
                          >
                            {' '}· {f.realized > 0 ? '+' : '−'}
                            {formatByCountry(Math.abs(f.realized), f.country)} gained
                          </span>
                        )}
                      </span>
                      <span
                        className={
                          outstanding > 0
                            ? 'font-semibold text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }
                      >
                        {outstanding > 0
                          ? `owes ${formatByCountry(outstanding, f.country)}`
                          : `settled · gave ${formatByCountry(f.received, f.country)}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </CollapsibleSection>
          )}
        </>
      )}

      <div className="card p-4 space-y-3">
        <input
          type="text"
          placeholder="Search items or notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={friendFilter} onChange={(e) => setFriendFilter(e.target.value)} className="input">
            <option value="">All friends</option>
            {friendNames.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input">
            <option value="">All statuses</option>
            <option value="open">Still owed</option>
            <option value="settled">Settled</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={handleExport} className="btn-ghost py-2 text-xs">
            ⬇ Export CSV
          </button>
          <CsvImportButton mapRow={importMapRow} onImport={addMany} />
        </div>
      </div>

      {unfunded.count > 0 && <UnfundedCard unfunded={unfunded} />}

      <div className="space-y-2">
        {loading && (
          <>
            <Skeleton className="h-[72px] w-full" />
            <Skeleton className="h-[72px] w-full" />
          </>
        )}
        {!loading && filteredList.length === 0 && (
          <EmptyState
            icon="🤝"
            message="Nothing here yet — log something you bought for a friend"
            actionLabel="+ Add friend purchase"
            onAction={() => {
              setEditing(null)
              setShowForm(true)
            }}
          />
        )}
        {filteredList.map((p) => (
          <SwipeableRow
            key={p.id}
            onEdit={() => {
              setEditing(p)
              setShowForm(true)
            }}
            onDelete={() => requestDelete(p.id)}
          >
            <PurchaseRow
              purchase={p}
              onPay={() => setPaying(p)}
              onEdit={() => {
                setEditing(p)
                setShowForm(true)
              }}
              onDelete={() => requestDelete(p.id)}
            />
          </SwipeableRow>
        ))}
      </div>

      <FloatingActionButton
        label="Add friend purchase"
        onClick={() => {
          setEditing(null)
          setShowForm(true)
        }}
      />

      {showForm && (
        <FriendPurchaseForm
          initial={editing}
          friendNames={friendNames}
          onClose={() => setShowForm(false)}
        />
      )}
      {paying && (
        <RecordPaymentSheet
          purchase={paying}
          update={update}
          onMoneyIn={addAccountEntry}
          onClose={() => setPaying(null)}
        />
      )}
      {groupSettling && (
        <GroupSettleSheet
          onMoneyIn={addAccountEntry}
          friend={groupSettling}
          // Only this friend's OPEN items in this currency get touched
          items={data.filter(
            (p) =>
              p.friend === groupSettling.friend &&
              (p.country || 'JP') === groupSettling.country &&
              !isSettled(p)
          )}
          update={update}
          onClose={() => setGroupSettling(null)}
        />
      )}
    </div>
  )
}

function LedgerSummaryCard({ country, totals }) {
  const fmt = (v) => formatByCountry(v, country)
  const iOwe = totals.cost - totals.paid
  const owedToMe = totals.due - totals.received
  const plClass = (v) =>
    v > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : v < 0
        ? 'text-red-500 dark:text-red-400'
        : 'text-gray-900 dark:text-gray-100'

  return (
    <div className="card p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        🤝 Friend ledger {country === 'IN' ? '(INR)' : '(JPY)'}
      </h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">You have to give</p>
          <p className="text-base font-bold tabular-nums text-gray-900 dark:text-gray-100">{fmt(totals.cost)}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            gave {fmt(totals.paid)}
            {iOwe > 0 && <span className="text-amber-600 dark:text-amber-400"> · {fmt(iOwe)} pending</span>}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Friends have to give you</p>
          <p className="text-base font-bold tabular-nums text-gray-900 dark:text-gray-100">{fmt(totals.due)}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            gave {fmt(totals.received)}
            {owedToMe > 0 && (
              <span className="text-amber-600 dark:text-amber-400"> · {fmt(owedToMe)} pending</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
            Profit / loss (settled)
          </p>
          <p className={`text-base font-bold tabular-nums ${plClass(totals.realized)}`}>
            {totals.realized > 0 ? '+' : ''}
            {fmt(totals.realized)}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            from {totals.settledCount} settled item{totals.settledCount === 1 ? '' : 's'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Expected if all settle</p>
          <p className={`text-base font-bold tabular-nums ${plClass(totals.expected)}`}>
            {totals.expected > 0 ? '+' : ''}
            {fmt(totals.expected)}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">cash in minus cash out</p>
        </div>
      </div>
    </div>
  )
}

function PurchaseRow({ purchase: p, onPay, onEdit, onDelete }) {
  const country = p.country || 'JP'
  const outstanding = Math.max(0, (p.due || 0) - (p.received || 0))
  const settled = isSettled(p)
  // Profit/loss = cash received minus cash you actually paid out.
  const profit = cashPL(p)
  // Closed short = accepted as final even though they gave less than owed.
  const closedShort = p.closed === true && (p.received || 0) < (p.due || 0)

  return (
    <div className="card p-3 pl-4 flex items-center gap-3 animate-[toast-in_0.15s_ease-out]">
      <span className="icon-tile">
        <ShoppingBag size={15} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
          {p.item} <span className="font-normal text-gray-500 dark:text-gray-400">· {p.friend}</span>
        </p>
        <p className="text-xs text-gray-500 truncate dark:text-gray-400">
          {toDate(p.date)?.toLocaleDateString()} · cost {formatByCountry(p.cost, country)} · owes{' '}
          {formatByCountry(p.due, country)}
          {p.note && ` · ${p.note}`}
        </p>
        {settled ? (
          <p
            className={`text-[11px] font-semibold ${
              profit > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : profit < 0
                  ? 'text-red-500 dark:text-red-400'
                  : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            ✓ Settled{closedShort && ' (closed short)'}
            {profit !== 0 &&
              ` · ${profit > 0 ? '+' : '−'}${formatByCountry(Math.abs(profit), country)} ${profit > 0 ? 'profit' : 'loss'}`}
          </p>
        ) : (
          <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
            {formatByCountry(outstanding, country)} still owed
            {(p.received || 0) > 0 && ` · got ${formatByCountry(p.received, country)}`}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-0.5">
        {!settled && (
          <button
            type="button"
            onClick={onPay}
            aria-label="Record payment"
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-emerald-600 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-emerald-400"
          >
            <HandCoins size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit"
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-indigo-600 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-indigo-400"
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete"
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-red-400"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}

// Quick payment entry: adds to `received` without opening the full form.
// Handles all three settle outcomes:
//   · they pay exactly what's owed  → "Settle in full"
//   · they pay MORE than owed       → type the real amount; extra = profit
//   · they pay LESS and that's it   → "Accept & close" books the shortfall as loss
function RecordPaymentSheet({ purchase: p, update, onMoneyIn, onClose }) {
  const country = p.country || 'JP'
  const outstanding = Math.max(0, (p.due || 0) - (p.received || 0))
  const [amount, setAmount] = useState(String(outstanding || ''))
  const [landedIn, setLandedIn] = useState('Cash')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const amountNum = parseFloat(amount) || 0
  // Live preview of what this payment means: over the due = profit on the spot.
  const extra = amountNum - outstanding

  // Persist: add `value` to what's been received; `close` marks the item as
  // final regardless of whether the full due amount ever arrived.
  const save = async (value, close = false) => {
    setSaving(true)
    setError('')
    try {
      const payload = { received: (p.received || 0) + value }
      if (close) payload.closed = true
      await update(p.id, payload)
      if (landedIn && value > 0) {
        await onMoneyIn?.({
          direction: 'credit',
          account: landedIn,
          amount: value,
          country,
          reason: `${p.friend} paid you back`,
          date: new Date(),
        })
      }
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!amountNum || amountNum <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    await save(amountNum)
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={`${p.friend} paid you`}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {p.item} · {formatByCountry(outstanding, country)} still owed
      </p>
      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Amount received (type what they actually gave — more or less is fine)
        <input
          type="number"
          step="any"
          required
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input"
        />
      </label>

      <DestinationPicker country={country} value={landedIn} onChange={setLandedIn} />

      {/* Show the profit/loss consequence of this exact amount before saving */}
      {amountNum > 0 && extra !== 0 && (
        <p
          className={`text-xs font-medium ${
            extra > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {extra > 0
            ? `They're giving ${formatByCountry(extra, country)} extra → +${formatByCountry(extra, country)} profit 🟢`
            : `That's ${formatByCountry(Math.abs(extra), country)} short — use "Accept & close" below if they won't pay the rest (books it as a loss).`}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={saving || outstanding <= 0}
          onClick={() => save(outstanding)}
          className="btn-ghost py-3 text-sm flex items-center justify-center gap-1.5"
        >
          <CheckCircle2 size={15} aria-hidden="true" /> Settle in full
        </button>
        <button type="submit" disabled={saving} className="btn-primary py-3 text-sm">
          {saving ? 'Saving…' : 'Add payment'}
        </button>
      </div>

      {/* Escape hatch for "they gave what they gave, we're done": records the
          typed amount (if any) and closes the item so the gap becomes a loss. */}
      <button
        type="button"
        disabled={saving}
        onClick={() => save(Math.max(0, amountNum), true)}
        className="w-full py-2 text-xs font-medium text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
      >
        Accept {amountNum > 0 ? formatByCountry(amountNum, country) : 'nothing more'} & close this item
      </button>
    </BottomSheet>
  )
}

// Group settle: one payment clears (or partially fills) EVERY open item a
// friend has, oldest first — no more tapping through each row one by one.
//   · pay the full total          → everything settles exactly
//   · pay MORE than the total     → the extra lands on the last item as profit
//   · pay LESS + "accept & close" → items close anyway, shortfall books as loss
//   · pay LESS + "add payment"    → fills oldest items first, rest stay open
function GroupSettleSheet({ friend, items, update, onMoneyIn, onClose }) {
  const country = friend.country
  const [landedIn, setLandedIn] = useState('Cash')
  const totalOutstanding = items.reduce(
    (s, p) => s + Math.max(0, (p.due || 0) - (p.received || 0)),
    0
  )
  const [amount, setAmount] = useState(String(totalOutstanding || ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const amountNum = parseFloat(amount) || 0
  const extra = amountNum - totalOutstanding // >0 profit preview, <0 shortfall

  // Spread `value` across the open items, oldest date first. Returns
  // [{id, received, closed?}] update payloads.
  const distribute = (value, closeAll) => {
    const sorted = [...items].sort(
      (a, b) => (toDate(a.date)?.getTime() || 0) - (toDate(b.date)?.getTime() || 0)
    )
    let remaining = value
    return sorted.map((p, i) => {
      const owed = Math.max(0, (p.due || 0) - (p.received || 0))
      // Last item soaks up any overpayment so the total matches what they gave.
      const take = i === sorted.length - 1 ? remaining : Math.min(owed, remaining)
      remaining -= take
      const payload = { id: p.id, received: (p.received || 0) + Math.max(0, take) }
      if (closeAll) payload.closed = true
      return payload
    })
  }

  const save = async (value, closeAll = false) => {
    setSaving(true)
    setError('')
    try {
      // Firestore has no multi-doc update on the client free tier setup here,
      // so apply sequentially — a handful of docs at most.
      for (const { id, ...payload } of distribute(value, closeAll)) {
        await update(id, payload)
      }
      if (landedIn && value > 0) {
        await onMoneyIn?.({
          direction: 'credit',
          account: landedIn,
          amount: value,
          country,
          reason: `${friend.friend} settled up`,
          date: new Date(),
        })
      }
      onClose()
    } catch {
      setError('Could not save everything — check the list and retry.')
      setSaving(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!amountNum || amountNum <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    await save(amountNum)
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={`${friend.friend} settles up`}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* What's being cleared, so there's no mystery about the math */}
      <div className="space-y-1 rounded-xl border border-gray-200 bg-gray-100/80 p-3 text-xs dark:border-transparent dark:bg-neutral-800/50">
        {items.map((p) => (
          <p key={p.id} className="flex justify-between text-gray-600 dark:text-gray-300">
            <span className="truncate">{p.item}</span>
            <span className="shrink-0 pl-2 font-medium tabular-nums">
              {formatByCountry(Math.max(0, (p.due || 0) - (p.received || 0)), country)}
            </span>
          </p>
        ))}
        <p className="flex justify-between border-t border-gray-300 pt-1 font-semibold text-gray-800 dark:border-white/10 dark:text-gray-100">
          <span>Total owed</span>
          <span className="tabular-nums">{formatByCountry(totalOutstanding, country)}</span>
        </p>
      </div>

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Amount they gave you (more or less is fine)
        <input
          type="number"
          step="any"
          required
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input"
        />
      </label>

      <DestinationPicker country={country} value={landedIn} onChange={setLandedIn} />

      {/* Live profit/shortfall preview for the typed amount */}
      {amountNum > 0 && extra !== 0 && (
        <p
          className={`text-xs font-medium ${
            extra > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {extra > 0
            ? `${formatByCountry(extra, country)} extra → profit 🟢`
            : `${formatByCountry(Math.abs(extra), country)} short — "Accept & close all" books it as a loss, or "Add payment" keeps the rest owed.`}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => save(Math.max(0, amountNum), true)}
          className="btn-ghost py-3 text-sm"
        >
          Accept & close all
        </button>
        <button type="submit" disabled={saving} className="btn-primary py-3 text-sm">
          {saving ? 'Saving…' : 'Add payment'}
        </button>
      </div>
    </BottomSheet>
  )
}

// The one-sided half of this ledger, shown where the rows are.
//
// When a friend pays you back the page writes an accountEntries credit and your
// balance rises. Until now, lending wrote no matching debit — the form had no
// "paid from" field — so collecting on one of these raises a balance from money
// that was never taken out of it.
//
// Read-only on purpose. Every row here is a historical figure, and nothing gets
// rewritten without being looked at first.
function UnfundedCard({ unfunded }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="card border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        ⚠️ {unfunded.count} purchase{unfunded.count === 1 ? '' : 's'} with no money movement
        recorded
      </p>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        These say a friend owes you, but nothing records the money leaving an account. When they
        pay you back, your balance rises by money that never went out.
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        {unfunded.totals.map((t) => (
          <span key={t.country} className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {formatByCountry(t.amount, t.country)}
            <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
              across {t.count}
            </span>
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400"
      >
        {open ? 'Hide the list' : 'Show the list'}
      </button>

      {open && (
        <ul className="mt-2 space-y-1.5">
          {unfunded.rows.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">
                {p.friend || 'Unknown'} · {p.item || 'Purchase'}
                {toDate(p.date) ? ` · ${toDate(p.date).toLocaleDateString()}` : ''}
              </span>
              <span className="shrink-0 tabular-nums text-gray-900 dark:text-gray-100">
                {formatByCountry(p.paid ?? p.cost ?? 0, p.country || 'JP')}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        Nothing here has been changed. New purchases now ask where the money came from.
      </p>
    </div>
  )
}
