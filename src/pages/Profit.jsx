import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, ChevronRight, Trash2 } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useSettings } from '../hooks/useSettings'
import { useBatchOps } from '../hooks/useBatchOps'
import { useToast } from '../context/ToastContext'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { formatJPY, toDate, toDateInputValue, parseDateInput } from '../lib/format'
import { buildProfitSources, profitEvents, splitGainLoss } from '../lib/profit'
import {
  WINDFALL_KINDS,
  windfallKind,
  windfallProfit,
  sortWindfalls,
} from '../lib/windfall'
import { LOSS_KINDS, lossKind, lossAmount, sortLosses } from '../lib/loss'
import { passesWithResults } from '../lib/passes'
import BottomSheet from '../components/ui/BottomSheet'
import Skeleton from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'

// Everything you've made on top of what things cost — friend deals, office
// surplus, refunds you kept the goods for, a commuter pass beating the daily
// fares, and one-off windfalls like cashing out a card.
export default function Profit() {
  const friendPurchases = useCollection('friendPurchases')
  const claims = useCollection('commuteClaims')
  const orders = useCollection('onlineOrders')
  const passes = useCollection('commutePasses')
  const trips = useCollection('commuteTrips')
  const windfalls = useCollection('windfalls')
  const losses = useCollection('losses')
  const { settings } = useSettings()
  const batchOps = useBatchOps()
  const { toast } = useToast()
  // Deleting a gain takes the income it booked with it, and a loss takes its
  // expense — leaving the money side behind would quietly change your balance
  // to something no record explains.
  const removeWindfall = async (id) => {
    const w = windfalls.data.find((x) => x.id === id)
    await batchOps([
      ...(w?.incomeId ? [{ op: 'delete', name: 'income', id: w.incomeId }] : []),
      { op: 'delete', name: 'windfalls', id },
    ])
  }
  const removeLoss = async (id) => {
    const l = losses.data.find((x) => x.id === id)
    await batchOps([
      ...(l?.expenseId ? [{ op: 'delete', name: 'expenses', id: l.expenseId }] : []),
      { op: 'delete', name: 'losses', id },
    ])
  }
  const undo = useUndoableDelete(removeWindfall, 'Windfall')
  const undoLoss = useUndoableDelete(removeLoss, 'Loss')

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [addingLoss, setAddingLoss] = useState(false)
  const [editingLoss, setEditingLoss] = useState(null)

  const fare = settings?.commute?.fare ? settings.commute.fare * 2 : 560
  const accounts = settings?.accounts || []

  const loading =
    friendPurchases.loading ||
    claims.loading ||
    orders.loading ||
    passes.loading ||
    windfalls.loading ||
    losses.loading

  const liveWindfalls = useMemo(
    () => windfalls.data.filter((w) => !undo.pendingIds.has(w.id)),
    [windfalls.data, undo.pendingIds]
  )
  const liveLosses = useMemo(
    () => losses.data.filter((l) => !undoLoss.pendingIds.has(l.id)),
    [losses.data, undoLoss.pendingIds]
  )

  const feed = useMemo(
    () => ({
      friendPurchases: friendPurchases.data,
      claims: claims.data,
      orders: orders.data,
      passes: passes.data,
      trips: trips.data,
      windfalls: liveWindfalls,
      losses: liveLosses,
      fare,
    }),
    [friendPurchases.data, claims.data, orders.data, passes.data, trips.data, liveWindfalls, liveLosses, fare]
  )

  const { sources } = useMemo(() => buildProfitSources(feed), [feed])

  // Every individual gain and loss, newest first — the answer to "what made me
  // this?" and "where did it go?" from one list.
  const events = useMemo(() => profitEvents(feed), [feed])
  const { gains, losses: lossEvents, gained, lost, net, pendingGain, pendingLoss } = useMemo(
    () => splitGainLoss(events),
    [events]
  )

  const passRows = useMemo(
    () => passesWithResults(passes.data, trips.data, fare),
    [passes.data, trips.data, fare]
  )

  // A windfall can book the money as income when it actually landed in an
  // account — the same "only real money moves balances" rule as everywhere.
  const saveWindfall = async (payload, id) => {
    if (id) {
      await windfalls.update(id, payload)
      toast('✓ Windfall updated')
      return
    }
    const booksIncome = payload.status !== 'pending' && payload.account
    await batchOps([
      ...(booksIncome
        ? [
            {
              op: 'set',
              name: 'income',
              data: {
                amount: payload.received,
                source: windfallKind(payload.kind).label,
                gross: null,
                net: null,
                note: `${windfallKind(payload.kind).emoji} ${payload.label}`,
                account: payload.account,
                country: 'JP',
                date: payload.date,
              },
            },
          ]
        : []),
      {
        op: 'set',
        name: 'windfalls',
        data: (ids) => ({ ...payload, incomeId: booksIncome ? ids[0] : null }),
      },
    ])
    toast(
      `${windfallKind(payload.kind).emoji} ${formatJPY(windfallProfit(payload))} profit logged${
        booksIncome ? ` · ${formatJPY(payload.received)} into ${payload.account}` : ''
      }`
    )
  }

  // A loss can book the expense when the money really left an account. Left on
  // "don't book" by default: most losses recorded here — an under-reimbursed
  // trip, a fee already on a statement — are money you've ALREADY logged as
  // spending, and booking it again would charge you for it twice.
  const saveLoss = async (payload, id) => {
    if (id) {
      await losses.update(id, payload)
      toast('✓ Loss updated')
      return
    }
    const booksExpense = Boolean(payload.account)
    await batchOps([
      ...(booksExpense
        ? [
            {
              op: 'set',
              name: 'expenses',
              data: {
                amount: payload.paid,
                category: 'Other',
                country: 'JP',
                paymentMethod: payload.account,
                store: '',
                note: `${lossKind(payload.kind).emoji} ${payload.label}`,
                date: payload.date,
              },
            },
          ]
        : []),
      {
        op: 'set',
        name: 'losses',
        data: (ids) => ({ ...payload, expenseId: booksExpense ? ids[0] : null }),
      },
    ])
    toast(
      `📉 ${formatJPY(lossAmount(payload))} logged as lost${
        booksExpense ? ` · ${formatJPY(payload.paid)} out of ${payload.account}` : ''
      }`
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-16 lg:mx-auto lg:max-w-2xl lg:pb-0">
      {/* ---- The headline: both sides, then what's left ---- */}
      <div className="card p-4 space-y-3">
        <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          📈 Profit &amp; loss
        </h1>
        {/* Side by side, because one without the other is a half-truth: ¥400 of
            surplus means nothing if a claim short-paid you ¥336 the same week. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-emerald-500/10 px-3 py-2.5">
            <p className="text-xs text-emerald-700 dark:text-emerald-400">Made</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              +{formatJPY(gained)}
            </p>
            {pendingGain !== 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                +{formatJPY(pendingGain)} on the way
              </p>
            )}
          </div>
          <div className="rounded-xl bg-red-500/10 px-3 py-2.5">
            <p className="text-xs text-red-600 dark:text-red-400">Lost</p>
            <p className="text-2xl font-bold tabular-nums text-red-500 dark:text-red-400">
              −{formatJPY(lost)}
            </p>
            {pendingLoss !== 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {formatJPY(pendingLoss)} disputed
              </p>
            )}
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Left over after what things cost
          </p>
          <p
            className={`text-3xl font-bold tabular-nums ${
              net < 0 ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {net >= 0 ? '+' : '−'}
            {formatJPY(Math.abs(net))}
          </p>
        </div>
      </div>

      {/* ---- Where it came from ---- */}
      {sources.length === 0 ? (
        <EmptyState
          icon="📈"
          message="No profit tracked yet. Log a windfall, a commuter pass, or let a claim get approved above cost."
          actionLabel="Log a one-off gain"
          onAction={() => setAdding(true)}
        />
      ) : (
        <div className="card divide-y divide-gray-200 overflow-hidden dark:divide-white/5">
          {sources.map((s) => (
            <Link
              key={s.key}
              to={s.to}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 active:bg-gray-100 touch-manipulation dark:hover:bg-neutral-800/50"
            >
              <span aria-hidden="true" className="text-lg">{s.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">
                  {s.label}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{s.detail}</span>
                {s.pending ? (
                  <span className="block text-xs text-amber-600 dark:text-amber-400">
                    +{formatJPY(s.pending)} on the way
                  </span>
                ) : null}
              </span>
              <span
                className={`shrink-0 text-base font-bold tabular-nums ${
                  s.amount < 0
                    ? 'text-red-500 dark:text-red-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {s.amount >= 0 ? '+' : '−'}
                {formatJPY(Math.abs(s.amount))}
              </span>
              <ChevronRight size={16} className="shrink-0 text-gray-400" />
            </Link>
          ))}
        </div>
      )}

      {/* ---- Commuter passes: live break-even ---- */}
      {passRows.length > 0 && (
        <div className="card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            🚌 Commuter passes
          </h2>
          {passRows.map((p) => (
            <PassRow key={p.id} pass={p} />
          ))}
          <Link
            to="/commute"
            className="block text-xs font-medium text-indigo-600 dark:text-indigo-400"
          >
            Manage passes on the Commute page →
          </Link>
        </div>
      )}

      {/* ---- One-off gains ---- */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            ✨ One-off gains
          </h2>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-9 items-center gap-1 rounded-full bg-indigo-600 px-3 text-xs font-semibold text-white transition-transform active:scale-95 touch-manipulation dark:bg-indigo-500"
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {liveWindfalls.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Cancelled a Pasmo and got the balance back? Deposit returned? Log it here and it
            counts toward your profit.
          </p>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-white/5">
            {sortWindfalls(liveWindfalls).map((w) => {
              const kind = windfallKind(w.kind)
              const profit = windfallProfit(w)
              return (
                <div key={w.id} className="flex items-center gap-2.5 py-2.5">
                  <span aria-hidden="true" className="text-lg">{kind.emoji}</span>
                  <button
                    type="button"
                    onClick={() => setEditing(w)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                      {w.label}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {toDate(w.date)?.toLocaleDateString()} · got {formatJPY(w.received || 0)}
                      {w.cost > 0 && ` · cost you ${formatJPY(w.cost)}`}
                      {w.status === 'pending' && ' · not received yet'}
                    </span>
                  </button>
                  <span
                    className={`shrink-0 text-sm font-bold tabular-nums ${
                      w.status === 'pending'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    +{formatJPY(profit)}
                  </span>
                  <button
                    type="button"
                    onClick={() => undo.requestDelete(w.id)}
                    aria-label={`Delete ${w.label}`}
                    className="shrink-0 p-1.5 text-gray-400 transition-transform active:scale-90 hover:text-red-500"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ---- Losses you log by hand ---- */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            📉 Money lost
          </h2>
          <button
            type="button"
            onClick={() => setAddingLoss(true)}
            className="flex min-h-9 items-center gap-1 rounded-full border border-red-300 px-3 text-xs font-semibold text-red-600 transition-transform active:scale-95 touch-manipulation dark:border-red-500/40 dark:text-red-400"
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {liveLosses.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            A fee, a fine, a booking you couldn't use, cash that vanished. Claims the office
            short-paid already count themselves — don't log those twice.
          </p>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-white/5">
            {sortLosses(liveLosses).map((l) => {
              const kind = lossKind(l.kind)
              return (
                <div key={l.id} className="flex items-center gap-2.5 py-2.5">
                  <span aria-hidden="true" className="text-lg">{kind.emoji}</span>
                  <button
                    type="button"
                    onClick={() => setEditingLoss(l)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                      {l.label}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {toDate(l.date)?.toLocaleDateString()} · paid {formatJPY(l.paid || 0)}
                      {l.recovered > 0 && ` · ${formatJPY(l.recovered)} came back`}
                      {l.status === 'disputed' && ' · disputed'}
                    </span>
                  </button>
                  <span
                    className={`shrink-0 text-sm font-bold tabular-nums ${
                      l.status === 'disputed'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-red-500 dark:text-red-400'
                    }`}
                  >
                    −{formatJPY(lossAmount(l))}
                  </span>
                  <button
                    type="button"
                    onClick={() => undoLoss.requestDelete(l.id)}
                    aria-label={`Delete ${l.label}`}
                    className="shrink-0 p-1.5 text-gray-400 transition-transform active:scale-90 hover:text-red-500"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ---- Every gain, one row each ---- */}
      {events.length > 0 && (
        <div className="card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              🧾 What made this
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {gains.length} gain{gains.length === 1 ? '' : 's'} · {lossEvents.length} loss
              {lossEvents.length === 1 ? '' : 'es'}, newest first
            </p>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-white/5">
            {events.map((e) => (
              <Link
                key={e.id}
                to={e.to}
                className="flex items-center gap-3 py-2.5 transition-colors active:bg-gray-100/60 dark:active:bg-neutral-800/40"
              >
                <span aria-hidden="true" className="text-lg">{e.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                    {e.label}
                  </span>
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                    {e.date?.toLocaleDateString()} · {e.source} · {e.detail}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={`block text-sm font-bold tabular-nums ${
                      e.pending
                        ? 'text-amber-600 dark:text-amber-400'
                        : e.amount < 0
                          ? 'text-red-500 dark:text-red-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {e.amount >= 0 ? '+' : '−'}
                    {e.country === 'IN'
                      ? `₹${Math.abs(e.amount).toLocaleString('en-IN')}`
                      : formatJPY(Math.abs(e.amount))}
                  </span>
                  {e.pending && (
                    <span className="block text-[11px] text-amber-600 dark:text-amber-400">
                      not in yet
                    </span>
                  )}
                </span>
                <ChevronRight size={15} className="shrink-0 text-gray-400" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Only money you actually hold counts in the headline. Anything approved, promised or still
        running is shown separately as "on the way".
      </p>

      {(adding || editing) && (
        <WindfallSheet
          initial={editing}
          accounts={accounts}
          onSave={saveWindfall}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
        />
      )}

      {(addingLoss || editingLoss) && (
        <LossSheet
          initial={editingLoss}
          accounts={accounts}
          onSave={saveLoss}
          onClose={() => {
            setAddingLoss(false)
            setEditingLoss(null)
          }}
        />
      )}
    </div>
  )
}

// One pass with its live break-even bar.
function PassRow({ pass }) {
  const r = pass.result
  const pct = r.breakEvenDays ? Math.min(100, (r.days / r.breakEvenDays) * 100) : 0
  const earned = r.profit >= 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-gray-800 dark:text-gray-100">
          {pass.label || 'Commuter pass'}
        </span>
        <span
          className={`shrink-0 text-sm font-bold tabular-nums ${
            earned ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {earned ? '+' : '−'}
          {formatJPY(Math.abs(r.profit))}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-700">
        <div
          className={`h-full rounded-full transition-all ${earned ? 'bg-emerald-500' : 'bg-indigo-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {r.days} day{r.days === 1 ? '' : 's'} × {formatJPY(r.perDay)} = {formatJPY(r.claimable)}{' '}
        claimable vs {formatJPY(r.cost)} paid
        {!earned && r.breakEvenDays
          ? ` · ${Math.max(0, r.breakEvenDays - r.days)} more day${
              r.breakEvenDays - r.days === 1 ? '' : 's'
            } to break even`
          : ' · every further day is profit'}
      </p>
    </div>
  )
}

// Log a one-off gain. Two numbers, because only you know how much of the
// payout was your own money to begin with.
function WindfallSheet({ initial, accounts, onSave, onClose }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [kind, setKind] = useState(initial?.kind ?? 'cardRefund')
  const [received, setReceived] = useState(initial?.received ?? '')
  const [cost, setCost] = useState(initial?.cost ?? '')
  const [date, setDate] = useState(toDateInputValue(initial?.date))
  const [account, setAccount] = useState(initial?.account ?? '')
  const [pending, setPending] = useState(initial?.status === 'pending')
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const receivedNum = parseFloat(received) || 0
  // A bonus has no cost side — none of it was ever your money, so the box that
  // asks "how much of this was yours?" would only be a way to get it wrong.
  const pureGain = Boolean(windfallKind(kind).pureGain)
  const costNum = pureGain ? 0 : parseFloat(cost) || 0
  const profit = receivedNum - costNum

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!label.trim() || receivedNum <= 0) {
      setError('Give it a name and what you received.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(
        {
          label: label.trim(),
          kind,
          received: receivedNum,
          cost: costNum,
          date: parseDateInput(date),
          account: pending ? null : account || null,
          status: pending ? 'pending' : 'received',
          note: note.trim(),
        },
        initial?.id
      )
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={initial ? 'Edit gain' : 'One-off gain'}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        What was it?
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Pasmo cancelled — deposit + balance"
          required
          autoFocus={!initial}
          className="input"
        />
      </label>

      <div className="space-y-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">Kind</p>
        <div className="flex flex-wrap gap-2">
          {WINDFALL_KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              className={`min-h-9 rounded-full px-3 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                kind === k.key
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                  : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
              }`}
            >
              {k.emoji} {k.label}
            </button>
          ))}
        </div>
        {windfallKind(kind).hint && (
          <p className="text-xs text-gray-400 dark:text-gray-500">{windfallKind(kind).hint}</p>
        )}
      </div>

      <div className={pureGain ? '' : 'grid grid-cols-2 gap-3'}>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          {pureGain ? 'Bonus received (¥, after tax)' : 'You received (¥)'}
          <input
            type="number"
            step="any"
            required
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            className="input"
          />
        </label>
        {!pureGain && (
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Of that, your own money
            <input
              type="number"
              step="any"
              placeholder="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="input"
            />
          </label>
        )}
      </div>

      {/* The whole point, spelled out — because the answer depends entirely on
          whose money was in there, and only you know that. */}
      <div className="rounded-xl border border-gray-200 bg-gray-100/80 p-3 dark:border-transparent dark:bg-neutral-800/50">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">Counts as profit</span>
          <span
            className={`text-lg font-bold tabular-nums ${
              profit > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {profit >= 0 ? '+' : '−'}
            {formatJPY(Math.abs(profit))}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {pureGain
            ? 'A bonus is money on top of everything else — none of it replaces something you spent, so all of it counts as profit and it books as income too.'
            : costNum === 0
              ? "None of it was your money, so all of it is gain. If some of it was, put that in the second box and only the rest counts."
              : `${formatJPY(costNum)} of it was yours coming back, so only the rest is profit.`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Landed in
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            disabled={pending}
            className="input disabled:opacity-50"
          >
            <option value="">— don't book income —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.label}>
                {a.label}
              </option>
            ))}
            <option value="Cash">💵 Cash</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={pending}
          onChange={(e) => setPending(e.target.checked)}
          className="h-5 w-5 rounded accent-indigo-600"
        />
        Promised, but hasn't arrived yet
      </label>

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
      </label>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        {pending
          ? "Nothing is booked while it's still promised — it shows as \"on the way\" until you mark it received."
          : account
            ? `Books ${formatJPY(receivedNum)} of income into ${account}, so your balance matches reality.`
            : 'No income is booked — use this when the money never hit a tracked account.'}
      </p>

      <button type="submit" disabled={saving} className="btn-primary min-h-12 w-full text-sm">
        {saving ? 'Saving…' : initial ? 'Save changes' : 'Log this gain'}
      </button>
    </BottomSheet>
  )
}

// The mirror image of WindfallSheet. Two numbers again, because a loss you
// partly got back isn't the loss you first felt.
function LossSheet({ initial, accounts, onSave, onClose }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [kind, setKind] = useState(initial?.kind ?? 'unreimbursed')
  const [paid, setPaid] = useState(initial?.paid ?? '')
  const [recovered, setRecovered] = useState(initial?.recovered ?? '')
  const [date, setDate] = useState(toDateInputValue(initial?.date))
  const [account, setAccount] = useState(initial?.account ?? '')
  const [disputed, setDisputed] = useState(initial?.status === 'disputed')
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const paidNum = parseFloat(paid) || 0
  const recoveredNum = parseFloat(recovered) || 0
  const loss = Math.max(0, paidNum - recoveredNum)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!label.trim() || paidNum <= 0) {
      setError('Give it a name and what it cost you.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(
        {
          label: label.trim(),
          kind,
          paid: paidNum,
          recovered: recoveredNum,
          date: parseDateInput(date),
          account: account || null,
          status: disputed ? 'disputed' : 'written-off',
          note: note.trim(),
        },
        initial?.id
      )
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={initial ? 'Edit loss' : 'Log a loss'}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        What happened?
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Ayase visit — office wouldn't cover the full fare"
          required
          autoFocus={!initial}
          className="input"
        />
      </label>

      <div className="space-y-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">Kind</p>
        <div className="flex flex-wrap gap-2">
          {LOSS_KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              className={`min-h-9 rounded-full px-3 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                kind === k.key
                  ? 'bg-red-500 text-white'
                  : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
              }`}
            >
              {k.emoji} {k.label}
            </button>
          ))}
        </div>
        {lossKind(kind).hint && (
          <p className="text-xs text-gray-400 dark:text-gray-500">{lossKind(kind).hint}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          You paid (¥)
          <input
            type="number"
            step="any"
            required
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            className="input"
          />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Of that, came back
          <input
            type="number"
            step="any"
            placeholder="0"
            value={recovered}
            onChange={(e) => setRecovered(e.target.value)}
            className="input"
          />
        </label>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-100/80 p-3 dark:border-transparent dark:bg-neutral-800/50">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">Counts as loss</span>
          <span
            className={`text-lg font-bold tabular-nums ${
              loss > 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            −{formatJPY(loss)}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {recoveredNum === 0
            ? 'None of it came back, so the whole thing is a loss. If part of it did, put that in the second box and only the rest counts.'
            : `${formatJPY(recoveredNum)} of it came back, so only the rest is really gone.`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Came out of
          <select value={account} onChange={(e) => setAccount(e.target.value)} className="input">
            <option value="">— already logged / don't book —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.label}>
                {a.label}
              </option>
            ))}
            <option value="Cash">💵 Cash</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={disputed}
          onChange={(e) => setDisputed(e.target.checked)}
          className="h-5 w-5 rounded accent-red-500"
        />
        Disputed — might still come back
      </label>

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
      </label>

      {/* The double-count trap, said plainly: most of these are money you have
          already entered as spending somewhere else. */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {account
          ? `Books ${formatJPY(paidNum)} of spending out of ${account} — only do this if you haven't already logged it as an expense.`
          : 'Nothing is booked — the money already left through an expense you logged. This just records how much of it you never got back.'}
        {disputed && ' Disputed losses are shown apart until you settle them.'}
      </p>

      <button
        type="submit"
        disabled={saving}
        className="min-h-12 w-full rounded-xl bg-red-500 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-60"
      >
        {saving ? 'Saving…' : initial ? 'Save changes' : 'Log this loss'}
      </button>
    </BottomSheet>
  )
}
