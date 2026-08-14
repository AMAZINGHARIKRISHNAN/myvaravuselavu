import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2, Plus } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useBatchOps } from '../hooks/useBatchOps'
import { useToast } from '../context/ToastContext'
import {
  formatByCountry,
  toDateInputValue,
  parseDateInput,
  formatJPY,
  formatINR,
} from '../lib/format'
import { CATEGORY_ICONS } from '../lib/constants'
import { countryOf } from '../lib/money'
import {
  isActive,
  perDay,
  summarise,
  tagOps,
  tripExpenses,
  tripLength,
  tripTotals,
  untagOps,
  untaggedInRange,
} from '../lib/trips'
import BottomSheet from '../components/ui/BottomSheet'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'

// Trips: what one journey actually cost.
//
// Spending stays exactly where it was — in the month, the budgets, the savings
// rate. A trip is a second way of looking at the same records, never a separate
// ledger, so nothing here changes a total anywhere else.
export default function Trips() {
  const trips = useCollection('trips')
  const expenses = useCollection('expenses')
  const [editing, setEditing] = useState(null)
  const [openTrip, setOpenTrip] = useState(null)

  const rows = useMemo(
    () => summarise(trips.data, expenses.data),
    [trips.data, expenses.data]
  )

  if (trips.loading || expenses.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-white">Trips</h1>
        <p className="text-xs text-gray-400">
          Tag what you spend on a journey and see it totalled on its own. It still counts in your
          month — this is a second view of it, not a second ledger.
        </p>
      </header>

      {/* On the page rather than floating over it: a round button in the corner
          is a guess you have to make, and there is room here to just say it. */}
      <button
        type="button"
        onClick={() => setEditing({})}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-500/40 py-3.5 text-sm font-semibold text-indigo-500 transition-transform active:scale-[0.99] touch-manipulation hover:border-indigo-500/60 hover:bg-indigo-500/5 dark:text-indigo-400"
      >
        <Plus size={16} aria-hidden="true" />
        New trip
      </button>

      {rows.length === 0 ? (
        <EmptyState
          icon="🧳"
          title="No trips yet"
          hint="Add one with its dates, and everything you spend while it runs tags itself to it."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((trip) => (
            <button
              key={trip.id}
              type="button"
              onClick={() => setOpenTrip(trip.id)}
              className="card w-full space-y-2 p-4 text-left transition-transform active:scale-[0.99] touch-manipulation"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    <span aria-hidden="true">🧳</span>
                    <span className="truncate">{trip.name}</span>
                    {isActive(trip) && (
                      <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        on now
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                    {trip.startDate && new Date(trip.startDate).toLocaleDateString()}
                    {trip.endDate && ` → ${new Date(trip.endDate).toLocaleDateString()}`} ·{' '}
                    {trip.days} day{trip.days === 1 ? '' : 's'} · {trip.count} entr
                    {trip.count === 1 ? 'y' : 'ies'}
                  </span>
                </span>
                <Amounts totals={trip.totals} className="shrink-0 text-right" />
              </div>
              {(trip.totals.JP > 0 || trip.totals.IN > 0) && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {trip.totals.JP > 0 && `${formatJPY(Math.round(trip.perDay.JP))}/day`}
                  {trip.totals.JP > 0 && trip.totals.IN > 0 && ' · '}
                  {trip.totals.IN > 0 && `${formatINR(trip.perDay.IN)}/day`}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {editing && <TripForm initial={editing.id ? editing : null} onClose={() => setEditing(null)} />}
      {openTrip && (
        <TripSheet
          trip={trips.data.find((t) => t.id === openTrip)}
          expenses={expenses.data}
          onEdit={(t) => {
            setOpenTrip(null)
            setEditing(t)
          }}
          onClose={() => setOpenTrip(null)}
        />
      )}
    </div>
  )
}

// Both currencies, never added together — a trip home is yen until you land.
function Amounts({ totals, className = '' }) {
  const both = totals.JP > 0 && totals.IN > 0
  if (!both && totals.JP === 0 && totals.IN === 0) {
    return <span className={`text-sm text-gray-400 ${className}`}>—</span>
  }
  return (
    <span className={className}>
      {totals.JP > 0 && (
        <span className="block text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {formatJPY(totals.JP)}
        </span>
      )}
      {totals.IN > 0 && (
        <span className="block text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {formatINR(totals.IN)}
        </span>
      )}
    </span>
  )
}

function TripForm({ initial, onClose }) {
  const { add, update } = useCollection('trips')
  const { toast } = useToast()
  const [name, setName] = useState(initial?.name ?? '')
  const [startDate, setStartDate] = useState(toDateInputValue(initial?.startDate))
  const [endDate, setEndDate] = useState(
    initial?.endDate ? toDateInputValue(initial.endDate) : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Give the trip a name.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        startDate: parseDateInput(startDate),
        endDate: endDate ? parseDateInput(endDate) : null,
        // The generic subscription orders by `date`, and a document without one
        // is invisible to every screen — see lib/invisible.js.
        date: parseDateInput(startDate),
      }
      if (initial?.id) await update(initial.id, payload)
      else await add(payload)
      toast(`🧳 ${payload.name} saved`)
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={initial ? 'Edit trip' : 'New trip'}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Where to?
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Osaka, India — Diwali"
          required
          autoFocus
          className="input"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          From
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          To (optional)
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
        </label>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        While the trip is running, anything you log tags itself to it. Leave the end date empty for
        a trip you're on now and don't know the return date for.
      </p>
      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : initial ? 'Save changes' : 'Add trip'}
      </button>
    </BottomSheet>
  )
}

function TripSheet({ trip, expenses, onEdit, onClose }) {
  const batchOps = useBatchOps()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const { remove } = useCollection('trips')

  const tagged = useMemo(() => tripExpenses(expenses, trip?.id), [expenses, trip?.id])
  const totals = useMemo(() => tripTotals(expenses, trip?.id), [expenses, trip?.id])
  // Anything dated inside the trip that hasn't been tagged — offered, never
  // applied, so the rent landing mid-holiday can be left out of it.
  const candidates = useMemo(() => untaggedInRange(expenses, trip), [expenses, trip])

  if (!trip) return null
  const days = tripLength(trip)
  const rate = perDay(trip, totals.totals)

  const run = async (ops, message) => {
    setBusy(true)
    try {
      for (let i = 0; i < ops.length; i += 400) await batchOps(ops.slice(i, i + 400))
      toast(message)
    } catch {
      toast('⚠️ Could not save that — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet onClose={onClose} title={trip.name}>
      <div className="rounded-xl bg-gray-100/80 p-3 dark:bg-neutral-800/50">
        <Amounts totals={totals.totals} />
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          {totals.count} entr{totals.count === 1 ? 'y' : 'ies'} across {days} day
          {days === 1 ? '' : 's'}
          {totals.totals.JP > 0 && ` · ${formatJPY(Math.round(rate.JP))}/day`}
          {totals.totals.IN > 0 && ` · ${formatINR(rate.IN)}/day`}
        </p>
      </div>

      {/* Where it went, each currency on its own. */}
      {['JP', 'IN'].map((country) => {
        const cats = Object.entries(totals.byCategory[country]).sort((a, b) => b[1] - a[1])
        if (cats.length === 0) return null
        return (
          <div key={country} className="space-y-1">
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
              {country === 'JP' ? '🇯🇵 In yen' : '🇮🇳 In rupees'}
            </p>
            {cats.map(([cat, amount]) => (
              <div key={cat} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-gray-700 dark:text-gray-200">
                  {CATEGORY_ICONS[cat] || '📌'} {cat}
                </span>
                <span className="tabular-nums text-gray-900 dark:text-gray-100">
                  {formatByCountry(amount, country)}
                </span>
              </div>
            ))}
          </div>
        )
      })}

      {candidates.length > 0 && (
        <div className="space-y-2 rounded-xl bg-indigo-500/10 p-3">
          <p className="text-[11px] text-indigo-700 dark:text-indigo-300">
            {candidates.length} expense{candidates.length === 1 ? '' : 's'} fall
            {candidates.length === 1 ? 's' : ''} inside these dates but {candidates.length === 1 ? 'is' : 'are'}{' '}
            not on the trip yet. Add them if they belong — leave them if they're rent or bills.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                tagOps(candidates, trip.id),
                `🧳 ${candidates.length} added to ${trip.name}`
              )
            }
            className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60 dark:bg-indigo-500"
          >
            Add all {candidates.length} to this trip
          </button>
        </div>
      )}

      {tagged.length > 0 && (
        <div className="max-h-[40svh] space-y-0.5 overflow-y-auto">
          {tagged.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-gray-700 dark:text-gray-200">
                  {CATEGORY_ICONS[e.category] || '📌'} {e.note?.trim() || e.store || e.category}
                </span>
                <span className="block text-[10px] text-gray-500 dark:text-gray-400">
                  {e.date && new Date(e.date.toDate ? e.date.toDate() : e.date).toLocaleDateString()}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {formatByCountry(e.amount, countryOf(e))}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(untagOps(tagged, [e.id]), 'Removed from the trip')}
                aria-label="Remove from this trip"
                className="shrink-0 p-1 text-gray-400 transition-transform active:scale-90 hover:text-red-500"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="border-t border-gray-200 pt-2 text-[11px] text-gray-400 dark:border-white/10 dark:text-gray-500">
        Removing an entry here only untags it — the expense itself stays in{' '}
        <Link to="/history" className="text-indigo-500 underline">
          History
        </Link>{' '}
        and still counts in your month.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onEdit(trip)}
          className="min-h-11 flex-1 rounded-xl border border-gray-300/60 text-sm font-semibold text-gray-700 dark:border-white/10 dark:text-gray-200"
        >
          Edit dates
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            // Untag first: deleting the trip alone would leave every expense
            // pointing at something that no longer exists.
            await run(untagOps(tagged, tagged.map((e) => e.id)), `${trip.name} deleted`)
            await remove(trip.id)
            onClose()
          }}
          className="min-h-11 rounded-xl px-4 text-sm font-semibold text-red-600 dark:text-red-400"
        >
          Delete
        </button>
      </div>
    </BottomSheet>
  )
}
