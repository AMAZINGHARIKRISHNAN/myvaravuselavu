import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useCollectionWriters } from '../hooks/useCollectionWriters'
import { useBatchOps } from '../hooks/useBatchOps'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../context/ToastContext'
import { formatJPY, toDate, toDateInputValue, parseDateInput } from '../lib/format'
import {
  COMMUTE_LEGS,
  COMMUTE_METHODS,
  OTHER_LEG,
  claimStage,
  dateKey,
  isJpHoliday,
  isOtherTrip,
  missingCommuteDays,
  sumTrips,
  tripDisplay,
  tripLocked,
} from '../lib/commute'
import { cardBalance } from '../lib/wallet'
import { passesWithResults, passCovering } from '../lib/passes'
import BottomSheet from '../components/ui/BottomSheet'
import CollapsibleSection from '../components/ui/CollapsibleSection'
import FloatingActionButton from '../components/ui/FloatingActionButton'
import Skeleton from '../components/ui/Skeleton'

// Commute tracker: auto-logs the weekday home↔office bus runs, mirrors each
// trip into main expenses (it's real money), and keeps the Pasmo balance.
// Claiming that money back is NOT here — reports, receipts and approvals all
// live on the Reimbursements page, so there's one flow, not two.
export default function Commute() {
  const { settings, loading: settingsLoading, save } = useSettings()
  const cfg = settings?.commute
  const trips = useCollection('commuteTrips')
  // Claims are read-only here: this page logs the trips, the Reimbursements
  // page owns everything about getting the money back. All that's needed is
  // knowing which days are already on a report, so the calendar can grey them.
  const claims = useCollection('commuteClaims')
  const recharges = useCollection('pasmoRecharges')
  // Read-only: office purchases paid with Pasmo also come off the card.
  const officeItems = useCollection('officeReimbursements')
  const passes = useCollection('commutePasses')
  // Full expense feed: the Pasmo balance deducts EVERY expense paid with
  // Pasmo, no matter where in the app it was logged.
  const allExpenses = useCollection('expenses')
  const expenseWriters = useCollectionWriters('expenses')
  const batchOps = useBatchOps()
  const { toast } = useToast()

  const [editingTrip, setEditingTrip] = useState(null)
  const [showTripSheet, setShowTripSheet] = useState(false)

  // Passes are part of this gate on purpose: auto-log has to know whether a
  // pass covers the day before it decides to mirror fare as spending, and
  // an empty not-yet-loaded pass list would say "no pass" and double-count.
  const loading = settingsLoading || trips.loading || claims.loading || passes.loading

  // ---- Trip writes, mirrored into the main expense books ----

  const mirrorNote = (t) => {
    const d = tripDisplay(t)
    return `${d.emoji} ${d.label}${t.note ? ` · ${t.note}` : ''}`
  }

  const mirrorExpense = (payload, tripId) => ({
    amount: payload.amount,
    category: 'Transport',
    country: 'JP',
    paymentMethod: payload.method || 'Pasmo',
    note: mirrorNote(payload),
    date: payload.date,
    commuteTripId: tripId,
  })

  // One atomic commit: trip + its expense mirror land together or not at
  // all. Auto-logged trips use FIXED ids derived from day+leg, so even two
  // devices generating the same day can't create duplicates. `offset` is
  // this pair's position when several pairs share one batch.
  //
  // On a day a commuter pass covers there is no second op: the fare was
  // already paid once, in the pass. Mirroring it again would double-count the
  // spending and drain the card balance for rides that cost nothing today.
  // The trip itself always logs — that's what the office reimburses, and it's
  // what makes the pass earn out.
  const tripPairOps = (payload, fixedKey = null, offset = 0) => {
    if (passCovering(passes.data, payload.date)) {
      return [
        {
          op: 'set',
          name: 'commuteTrips',
          id: fixedKey ? `auto-${fixedKey}` : undefined,
          data: () => ({ ...payload, expenseId: null, passCovered: true }),
        },
      ]
    }
    return [
      {
        op: 'set',
        name: 'commuteTrips',
        id: fixedKey ? `auto-${fixedKey}` : undefined,
        data: (ids) => ({ ...payload, expenseId: ids[offset + 1], passCovered: false }),
      },
      {
        op: 'set',
        name: 'expenses',
        id: fixedKey ? `cma-${fixedKey}` : undefined,
        data: (ids) => mirrorExpense(payload, ids[offset]),
      },
    ]
  }

  const addTripSynced = async (payload, fixedKey = null) => {
    const ids = await batchOps(tripPairOps(payload, fixedKey))
    return { id: ids[0] }
  }

  const updateTripSynced = async (id, payload) => {
    await trips.update(id, payload)
    const prev = trips.data.find((t) => t.id === id)
    const covered = Boolean(passCovering(passes.data, payload.date))

    if (covered) {
      // Edited onto a day the pass covers — the fare stops being real money.
      if (prev?.expenseId) {
        await expenseWriters.remove(prev.expenseId)
        await trips.update(id, { expenseId: null, passCovered: true })
      } else if (!prev?.passCovered) {
        await trips.update(id, { passCovered: true })
      }
      return
    }

    // Moved back off the pass (or past its end date): from here the ride costs
    // real money again, so it needs its mirror back.
    if (!prev?.expenseId && prev?.passCovered) {
      const expRef = await expenseWriters.add(mirrorExpense(payload, id))
      await trips.update(id, { expenseId: expRef.id, passCovered: false })
      return
    }

    if (prev?.expenseId) {
      try {
        await expenseWriters.update(prev.expenseId, {
          amount: payload.amount,
          paymentMethod: payload.method || 'Pasmo',
          note: mirrorNote(payload),
          date: payload.date,
        })
      } catch {
        // Mirror was deleted elsewhere — self-heal by recreating it so the
        // trip's money exists in the books again.
        const expRef = await expenseWriters.add({
          amount: payload.amount,
          category: 'Transport',
          country: 'JP',
          paymentMethod: payload.method || 'Pasmo',
          note: mirrorNote(payload),
          date: payload.date,
          commuteTripId: id,
        })
        await trips.update(id, { expenseId: expRef.id })
      }
    }
  }

  const removeTripSynced = async (id) => {
    const trip = trips.data.find((t) => t.id === id)
    const ops = [{ op: 'delete', name: 'commuteTrips', id }]
    if (trip?.expenseId) ops.push({ op: 'delete', name: 'expenses', id: trip.expenseId })
    await batchOps(ops) // atomic: trip and its money leave together
  }

  // ---- Weekday auto-log: fills every missed weekday (capped) once per open ----

  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || loading || !cfg?.enabled || !cfg.auto) return
    autoRan.current = true
    ;(async () => {
      try {
        const days = missingCommuteDays(cfg.lastGenerated, new Date())
        const existing = new Set(trips.data.map((t) => `${t.dateKey}|${t.leg}`))
        // One atomic commit for the whole catch-up; fixed ids per day+leg
        // mean a second device racing this can't create duplicates.
        const ops = []
        let created = 0
        for (const day of days) {
          for (const leg of COMMUTE_LEGS) {
            if (existing.has(`${dateKey(day)}|${leg.key}`)) continue
            created += 1 // counted here: a pass-covered trip is one op, not two
            ops.push(
              ...tripPairOps(
                {
                  date: day,
                  dateKey: dateKey(day),
                  leg: leg.key,
                  amount: cfg.fare,
                  method: cfg.method || 'Pasmo',
                  note: '',
                  reimbursable: true,
                  claimId: null,
                },
                `${dateKey(day)}-${leg.key}`,
                ops.length
              )
            )
          }
        }
        if (ops.length > 0) await batchOps(ops)
        if (days.length > 0) {
          await save({ commute: { ...cfg, lastGenerated: dateKey(new Date()) } })
        }
        if (created > 0) toast(`🚌 ${created} commute trip${created === 1 ? '' : 's'} auto-logged`)
      } catch {
        toast('⚠️ Could not auto-log commutes — pull to refresh and retry')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cfg?.enabled, cfg?.auto])

  // ---- Derived views ----

  const todayKey = dateKey(new Date())
  const todayTrips = trips.data.filter((t) => t.dateKey === todayKey)

  // Pasmo wallet: money loaded on minus money spent with it, app-wide.
  const pasmoBalance = useMemo(
    () => cardBalance('Pasmo', recharges.data, allExpenses.data, officeItems.data, passes.data),
    [recharges.data, allExpenses.data, officeItems.data, passes.data]
  )
  const pasmoRecharges = useMemo(
    () => recharges.data.filter((r) => (r.card || 'Pasmo') === 'Pasmo'),
    [recharges.data]
  )

  // Which claim a trip belongs to, only so the calendar can show a day as
  // already filed. Nothing on this page changes a claim.
  const pendingClaimIds = useMemo(
    () => new Set(claims.data.filter((c) => claimStage(c) !== 'paid').map((c) => c.id)),
    [claims.data]
  )
  const approvedClaimIds = useMemo(
    () => new Set(claims.data.filter((c) => claimStage(c) === 'paid').map((c) => c.id)),
    [claims.data]
  )

  // Reimbursable trips not yet on any report — the count and total shown on
  // the card that links across to Reimbursements.
  const unclaimed = useMemo(
    () => trips.data.filter((t) => t.reimbursable !== false && !t.claimId),
    [trips.data]
  )
  const claimableDays = useMemo(
    () => new Set(unclaimed.map((t) => t.dateKey || dateKey(toDate(t.date) || new Date()))).size,
    [unclaimed]
  )

  // Calendar: empty days get MARKED first, then one OK logs the full
  // ¥fare×2 commute on every marked day. Logged days open for editing.
  const [daySheetKey, setDaySheetKey] = useState(null)
  const logDays = async (dayKeys) => {
    // All marked days land in ONE commit — instant even for a whole month,
    // and all-or-nothing if the connection drops mid-way.
    const ops = []
    for (const k of dayKeys) {
      const [y, m, d] = k.split('-').map(Number)
      const day = new Date(y, m - 1, d, 12)
      for (const leg of COMMUTE_LEGS) {
        ops.push(
          ...tripPairOps(
            {
              date: day,
              dateKey: k,
              leg: leg.key,
              amount: cfg.fare,
              method: cfg.method || 'Pasmo',
              note: '',
              reimbursable: true,
              claimId: null,
            },
            `${k}-${leg.key}`,
            ops.length
          )
        )
      }
    }
    await batchOps(ops)
    toast(
      `🚌 ${dayKeys.length} day${dayKeys.length === 1 ? '' : 's'} marked as commute · ${formatJPY(
        dayKeys.length * (cfg.fare || 0) * 2
      )}`
    )
  }


  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  // First visit: set the fare and how you normally pay, then it runs itself.
  if (!cfg?.enabled) {
    return <SetupCard save={save} />
  }

  return (
    <div className="space-y-4 pb-16 lg:pb-0">
      <TodayCard
        cfg={cfg}
        todayTrips={todayTrips}
        onLog={(leg) =>
          addTripSynced({
            date: new Date(),
            dateKey: todayKey,
            leg: leg.key,
            amount: cfg.fare,
            method: cfg.method || 'Pasmo',
            note: '',
            reimbursable: true,
            claimId: null,
          })
        }
        onEdit={(t) => {
          setEditingTrip(t)
          setShowTripSheet(true)
        }}
        onAddOther={() => {
          // Prefill (no id) → TripSheet opens on the "other" kind for today.
          setEditingTrip({ leg: OTHER_LEG, date: new Date() })
          setShowTripSheet(true)
        }}
      />

      {/* ---- Commuter pass: a flat cost against the per-day rate the office
              reimburses. Every day past break-even is profit. ---- */}
      <PassCard
        passes={passes.data}
        trips={trips.data}
        fare={(cfg.fare || 280) * 2}
        onAdd={passes.add}
        onUpdate={passes.update}
        onDelete={passes.remove}
      />

      {/* ---- Pasmo wallet: recharge + live balance; spending with Pasmo
              anywhere in the app deducts automatically ---- */}
      <PasmoCard
        balance={pasmoBalance}
        fare={cfg.fare || 280}
        loading={recharges.loading || allExpenses.loading}
        recharges={pasmoRecharges}
        onAdd={recharges.add}
        onDelete={recharges.remove}
      />

      {/* ---- Calendar: mark the days you commuted, hit OK, each day gets
              its full up-and-down. Colored days open for editing. ---- */}
      <CalendarCard
        cfg={cfg}
        trips={trips.data}
        pendingClaimIds={pendingClaimIds}
        approvedClaimIds={approvedClaimIds}
        todayKey={todayKey}
        onOpenDay={setDaySheetKey}
        onLogDays={logDays}
      />

      {/* ---- Claiming lives on the Reimbursements page ----
              Commute days flow there on their own; bundling them into a
              report, receipts, approvals and the money landing are all
              tracked in one place so nothing is counted twice. ---- */}
      {claimableDays > 0 && (
        <Link
          to="/reimbursements"
          className="card flex items-center gap-3 p-4 transition-transform active:scale-[0.99] touch-manipulation"
        >
          <span className="text-xl" aria-hidden="true">💼</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
              Ready to claim
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {claimableDays} commute day{claimableDays === 1 ? '' : 's'} waiting to go on a report
            </span>
          </span>
          <span className="shrink-0 text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {formatJPY(sumTrips(unclaimed))}
          </span>
          <ChevronRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
        </Link>
      )}

      <CollapsibleSection icon="⚙️" title="Commute settings" subtitle={`${formatJPY(cfg.fare)} one way · ${cfg.method || 'Pasmo'} · auto ${cfg.auto ? 'on' : 'off'}`}>
        <SettingsCard cfg={cfg} save={save} />
      </CollapsibleSection>

      <FloatingActionButton
        label="Add a trip"
        onClick={() => {
          setEditingTrip(null)
          setShowTripSheet(true)
        }}
      />

      {showTripSheet && (
        <TripSheet
          cfg={cfg}
          initial={editingTrip}
          onSave={async (payload) => {
            if (editingTrip?.id) await updateTripSynced(editingTrip.id, payload)
            else await addTripSynced(payload)
          }}
          onClose={() => {
            setShowTripSheet(false)
            setEditingTrip(null)
          }}
        />
      )}
      {daySheetKey && (
        <DaySheet
          dayKey={daySheetKey}
          cfg={cfg}
          trips={trips.data.filter((t) => t.dateKey === daySheetKey)}
          pendingClaimIds={pendingClaimIds}
          approvedClaimIds={approvedClaimIds}
          onLogLeg={(leg, day) =>
            addTripSynced({
              date: day,
              dateKey: dateKey(day),
              leg: leg.key,
              amount: cfg.fare,
              method: cfg.method || 'Pasmo',
              note: '',
              reimbursable: true,
              claimId: null,
            })
          }
          onAddOther={(day) => {
            setDaySheetKey(null)
            setEditingTrip({ leg: OTHER_LEG, date: day })
            setShowTripSheet(true)
          }}
          onEditTrip={(t) => {
            if (tripLocked(t)) {
              toast('🔒 In a claim — ungroup it first to edit')
              return
            }
            setDaySheetKey(null)
            setEditingTrip(t)
            setShowTripSheet(true)
          }}
          onDeleteTrip={(t) => {
            if (tripLocked(t)) {
              toast('🔒 In a claim — ungroup it first to delete')
              return
            }
            removeTripSynced(t.id)
          }}
          onClose={() => setDaySheetKey(null)}
        />
      )}
    </div>
  )
}

// A commuter pass costs a flat amount however much you travel, while the
// office reimburses per commuting day. The bar shows how close the pass is to
// paying for itself; past that line, every day you come in is profit.
function PassCard({ passes, trips, fare, onAdd, onUpdate, onDelete }) {
  const { toast } = useToast()
  const [showSheet, setShowSheet] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const rows = useMemo(() => passesWithResults(passes, trips, fare), [passes, trips, fare])

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🎫 Commuter pass</h2>
        <button
          type="button"
          onClick={() => setShowSheet(true)}
          className="min-h-9 rounded-full bg-indigo-600 px-3 text-xs font-semibold text-white transition-transform active:scale-95 touch-manipulation dark:bg-indigo-500"
        >
          + Add pass
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Bought a monthly pass? Add it here. The office still reimburses{' '}
          {formatJPY(fare)} per commuting day, so once the pass has paid for itself every extra
          day is profit — tracked automatically from the days you log.
        </p>
      ) : (
        rows.map((p) => {
          const r = p.result
          const pct = r.breakEvenDays ? Math.min(100, (r.days / r.breakEvenDays) * 100) : 0
          const earned = r.profit >= 0
          return (
            <div key={p.id} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                  {p.label || 'Commuter pass'}
                  {r.expired && <span className="text-gray-400"> · ended</span>}
                </span>
                <span
                  className={`shrink-0 text-sm font-bold tabular-nums ${
                    earned
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {earned ? '+' : '−'}
                  {formatJPY(Math.abs(r.profit))}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    confirmId === p.id
                      ? (onDelete(p.id), setConfirmId(null), toast('🗑 Pass deleted'))
                      : setConfirmId(p.id)
                  }
                  aria-label="Delete pass"
                  className={`shrink-0 p-1 transition-transform active:scale-90 ${
                    confirmId === p.id ? 'text-red-500' : 'text-gray-400 hover:text-red-500'
                  }`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-700">
                <div
                  className={`h-full rounded-full transition-all ${
                    earned ? 'bg-emerald-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {confirmId === p.id ? (
                  <span className="font-medium text-red-500">Tap the bin again to delete</span>
                ) : (
                  <>
                    {r.days} day{r.days === 1 ? '' : 's'} × {formatJPY(r.perDay)} ={' '}
                    {formatJPY(r.claimable)} claimable vs {formatJPY(r.cost)} paid
                    {p.paidFrom ? ` from ${p.paidFrom}` : ''}
                    {!earned && r.breakEvenDays
                      ? ` · ${Math.max(0, r.breakEvenDays - r.days)} more to break even`
                      : ' · every further day is profit'}
                  </>
                )}
              </p>

              {/* Refundable card deposit — recoverable money, with a one-tap
                  "returned the card" that restores the balance it came from. */}
              {(p.deposit || 0) > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-100/70 px-2.5 py-1.5 dark:bg-neutral-800/50">
                  {p.depositRefunded ? (
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      🎟️ {formatJPY(p.deposit)} card deposit refunded
                    </span>
                  ) : (
                    <>
                      <span className="text-[11px] text-amber-600 dark:text-amber-400">
                        🎟️ {formatJPY(p.deposit)} deposit held
                        {p.depositPaidFrom ? ` (${p.depositPaidFrom})` : ''} — get it back on return
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await onUpdate(p.id, { depositRefunded: true })
                          toast(`🎟️ ${formatJPY(p.deposit)} deposit refunded`)
                        }}
                        className="shrink-0 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-transform active:scale-95 dark:bg-emerald-500"
                      >
                        Returned card
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      {showSheet && (
        <PassSheet
          fare={fare}
          onAdd={async (payload) => {
            await onAdd(payload)
            toast(`🎫 ${payload.label} added · ${formatJPY(payload.cost)}`)
          }}
          onClose={() => setShowSheet(false)}
        />
      )}
    </div>
  )
}

// Where the money to buy a pass came from: cash or a bank account. Transit
// cards aren't offered — you don't fund a pass out of a card's stored fare.
function paymentSources(settings) {
  const accounts = (settings?.accounts || []).filter((a) => a.country === 'JP').map((a) => a.label)
  return ['Cash', ...accounts]
}

// A row of pill buttons for choosing where money came from.
function SourcePills({ value, onChange, sources }) {
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={`min-h-9 rounded-full px-3.5 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
            value === s
              ? 'bg-indigo-600 text-white dark:bg-indigo-500'
              : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
          }`}
        >
          {s === 'Cash' ? '💵 Cash' : s}
        </button>
      ))}
    </div>
  )
}

function PassSheet({ fare, onAdd, onClose }) {
  const { settings } = useSettings()
  const sources = paymentSources(settings)
  const today = new Date()
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  const [label, setLabel] = useState(
    `${today.toLocaleString('en', { month: 'long' })} commuter pass`
  )
  const [cost, setCost] = useState('')
  const [paidFrom, setPaidFrom] = useState(sources[sources.length > 1 ? 1 : 0]) // a bank account if set up, else Cash
  const [startDate, setStartDate] = useState(toDateInputValue(today))
  const [endDate, setEndDate] = useState(toDateInputValue(monthEnd))
  const [dailyRate, setDailyRate] = useState(String(fare))
  // Refundable card deposit — you get it back when you hand the card in.
  const [hasDeposit, setHasDeposit] = useState(false)
  const [deposit, setDeposit] = useState('500')
  const [depositPaidFrom, setDepositPaidFrom] = useState('Cash')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const costNum = parseFloat(cost) || 0
  const rateNum = parseFloat(dailyRate) || 0
  const depositNum = hasDeposit ? parseFloat(deposit) || 0 : 0
  const breakEven = rateNum > 0 ? Math.ceil(costNum / rateNum) : null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!label.trim() || costNum <= 0) {
      setError('Name the pass and what it cost.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onAdd({
        label: label.trim(),
        cost: costNum,
        paidFrom, // where the pass/recharge money came from
        dailyRate: rateNum,
        deposit: depositNum, // 0 = no card deposit
        depositPaidFrom: depositNum > 0 ? depositPaidFrom : null,
        depositRefunded: false,
        startDate: parseDateInput(startDate),
        endDate: endDate ? parseDateInput(endDate) : null,
        date: parseDateInput(startDate), // sorts with everything else
      })
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title="Commuter pass">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Name
        <input value={label} onChange={(e) => setLabel(e.target.value)} required className="input" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Pass cost (¥)
          <input
            type="number"
            step="any"
            required
            autoFocus
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="input"
          />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Office pays per day (¥)
          <input
            type="number"
            step="any"
            value={dailyRate}
            onChange={(e) => setDailyRate(e.target.value)}
            className="input"
          />
        </label>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Paid for the pass with (that balance goes down by {formatJPY(costNum)})
        </p>
        <SourcePills value={paidFrom} onChange={setPaidFrom} sources={sources} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Valid from
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="input"
          />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Valid until
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input"
          />
        </label>
      </div>

      {/* Refundable card deposit: often a separate ¥500 you paid in cash for
          the physical card, returned when you hand the card back. */}
      <div className="rounded-xl border border-gray-200 p-3 space-y-2.5 dark:border-neutral-700">
        <label className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={hasDeposit}
            onChange={(e) => setHasDeposit(e.target.checked)}
            className="h-5 w-5 rounded accent-indigo-600"
          />
          🎟️ There's a refundable card deposit
        </label>
        {hasDeposit && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
                Deposit (¥)
                <input
                  type="number"
                  step="any"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  className="input"
                />
              </label>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 dark:text-gray-400">Deposit paid with</p>
              <SourcePills
                value={depositPaidFrom}
                onChange={setDepositPaidFrom}
                sources={sources}
              />
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Comes off {depositPaidFrom === 'Cash' ? 'your cash' : depositPaidFrom} now, and you
              get it back when you return the card — mark it returned then and the balance restores
              itself.
            </p>
          </>
        )}
      </div>

      {breakEven !== null && costNum > 0 && (
        <p className="rounded-xl bg-gray-100/80 p-3 text-xs text-gray-600 dark:bg-neutral-800/50 dark:text-gray-300">
          Commute <span className="font-semibold">{breakEven} days</span> and the pass has paid for
          itself. Every day after that, the {formatJPY(rateNum)} the office reimburses is pure
          profit — counted from the days you already log here.
        </p>
      )}

      <button type="submit" disabled={saving} className="btn-primary min-h-12 w-full text-sm">
        {saving ? 'Saving…' : 'Add pass'}
      </button>
    </BottomSheet>
  )
}

// The Pasmo wallet: what's loaded, how many trips that buys, and a top-up
// button. A top-up is never an expense (the trips paid with the card already
// are, so counting the recharge too would double it).
function PasmoCard({ balance, fare, loading, recharges, onAdd, onDelete }) {
  const { toast } = useToast()
  const [showRecharge, setShowRecharge] = useState(false)
  const tripsLeft = fare > 0 ? Math.max(0, Math.floor(balance / fare)) : 0
  const low = balance < fare * 2 // less than one full day left

  const recent = [...recharges]
    .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))
    .slice(0, 8)

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">💳 Pasmo balance</h2>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-24" />
          ) : (
            <p
              className={`text-xl font-bold tabular-nums ${
                balance < 0
                  ? 'text-red-500 dark:text-red-400'
                  : low
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {formatJPY(balance)}
            </p>
          )}
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {balance < 0
              ? 'Below zero — add your first recharge with the card’s current balance'
              : low
                ? `⚠️ Low — about ${tripsLeft} trip${tripsLeft === 1 ? '' : 's'} left, recharge soon`
                : `≈ ${tripsLeft} bus trips · auto-deducts whenever you pay with Pasmo`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowRecharge(true)}
          className="btn-primary shrink-0 px-3.5 py-2 text-xs"
        >
          + Recharge
        </button>
      </div>

      {recent.length > 0 && (
        <CollapsibleSection icon="🧾" title="Recharge history" subtitle={`${recharges.length} top-up${recharges.length === 1 ? '' : 's'}`}>
          <div className="space-y-1">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
                <span className="min-w-0 truncate">
                  {toDate(r.date)?.toLocaleDateString()}
                  {r.note && <span className="text-gray-500 dark:text-gray-400"> · {r.note}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    +{formatJPY(r.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await onDelete(r.id)
                      toast('🗑 Recharge removed')
                    }}
                    aria-label="Delete recharge"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {showRecharge && (
        <RechargeSheet
          onAdd={onAdd}
          onClose={() => setShowRecharge(false)}
        />
      )}
    </div>
  )
}

// Top-up entry: quick amounts for the usual machine buttons, or type any.
// "Paid from" moves the money out of the paying account (bank → card);
// never an expense, so nothing double-counts.
function RechargeSheet({ onAdd, onClose }) {
  const { toast } = useToast()
  const { settings } = useSettings()
  const accounts = settings?.accounts || []
  const [amount, setAmount] = useState('')
  const [paidFrom, setPaidFrom] = useState('Cash')
  const [date, setDate] = useState(toDateInputValue())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amountNum = parseFloat(amount) || 0
    if (amountNum <= 0) {
      setError('Enter the recharge amount.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onAdd({
        card: 'Pasmo',
        amount: amountNum,
        // 'Cash' is kept so the cash count knows those notes left your pocket;
        // it matches no account label, so no bank balance moves.
        paidFrom,
        date: parseDateInput(date),
        note: note.trim(),
      })
      toast(`💳 ${formatJPY(amountNum)} loaded onto Pasmo`)
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title="Recharge Pasmo">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {[1000, 2000, 3000, 5000, 10000].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setAmount(String(v))}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
              parseFloat(amount) === v
                ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
            }`}
          >
            {formatJPY(v)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Amount (¥)
          <input type="number" step="any" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
      </div>
      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <p>Paid from (that account's balance goes down)</p>
        <div className="flex flex-wrap gap-2">
          {['Cash', ...accounts.map((a) => a.label)].map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setPaidFrom(label)}
              className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                paidFrom === label
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                  : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Note (optional — e.g. station machine)
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
      </label>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Money moves {paidFrom === 'Cash' ? 'from cash' : `out of ${paidFrom}`} onto the card. Your
        Pasmo purchases already count as spending, so the top-up itself is never double-counted.
      </p>
      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : 'Add recharge'}
      </button>
    </BottomSheet>
  )
}

// Month grid: each day shows whether the commute is logged (and its total).
// Empty days: tap to MARK (dashed outline), tap OK to log ¥fare×2 on every
// marked day at once. Colored days: tap to open and edit that day.
function CalendarCard({ cfg, trips, pendingClaimIds, approvedClaimIds, todayKey, onOpenDay, onLogDays }) {
  const [month, setMonth] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [marked, setMarked] = useState(() => new Set())
  const [saving, setSaving] = useState(false)

  const byDay = useMemo(() => {
    const map = new Map()
    for (const t of trips) {
      const k = t.dateKey
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(t)
    }
    return map
  }, [trips])

  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < first.getDay(); i++) cells.push(null) // leading blanks (week starts Sunday)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), d, 12))
  }

  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🗓 Commute calendar</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="Previous month"
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-all hover:text-gray-900 active:scale-90 touch-manipulation dark:text-gray-400 dark:hover:text-gray-100"
          >
            ‹
          </button>
          <span className="min-w-28 text-center text-xs font-medium text-gray-600 dark:text-gray-300">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Next month"
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-all hover:text-gray-900 active:scale-90 touch-manipulation dark:text-gray-400 dark:hover:text-gray-100"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
            {d}
          </span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={`blank-${i}`} />
          const k = dateKey(day)
          const dayTrips = byDay.get(k) || []
          const logged = dayTrips.length > 0
          const allApproved =
            logged && dayTrips.every((t) => t.claimId && approvedClaimIds.has(t.claimId))
          const anyClaimed = logged && dayTrips.some((t) => t.claimId && pendingClaimIds.has(t.claimId))
          const isToday = k === todayKey
          const isFuture = k > todayKey
          const isMarked = marked.has(k)
          const holiday = isJpHoliday(day)
          return (
            <button
              key={k}
              type="button"
              disabled={isFuture || saving}
              onClick={() => {
                if (logged) {
                  onOpenDay(k)
                  return
                }
                // Empty day: toggle the mark; nothing is written until OK.
                setMarked((prev) => {
                  const next = new Set(prev)
                  if (next.has(k)) next.delete(k)
                  else next.add(k)
                  return next
                })
              }}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-[11px] leading-tight transition-transform active:scale-90 touch-manipulation ${
                isFuture
                  ? 'text-gray-300 dark:text-neutral-700'
                  : allApproved
                    ? 'bg-emerald-100 font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                    : anyClaimed
                      ? 'bg-amber-100 font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
                      : logged
                        ? 'bg-indigo-100 font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                        : isMarked
                          ? 'bg-indigo-600 font-semibold text-white dark:bg-indigo-500'
                          : holiday
                            ? 'text-rose-400 hover:bg-gray-100 dark:text-rose-400/80 dark:hover:bg-neutral-800'
                            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-neutral-800'
              } ${isToday ? 'ring-1 ring-indigo-500 dark:ring-indigo-400' : ''}`}
            >
              <span>{day.getDate()}</span>
              {logged ? (
                <span className="text-[8px] tabular-nums opacity-80">{sumTrips(dayTrips)}</span>
              ) : isMarked ? (
                <span className="text-[8px] tabular-nums opacity-90">{(cfg.fare || 0) * 2}</span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Confirm bar: appears once days are marked — one OK logs them all */}
      {marked.size > 0 && (
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => setMarked(new Set())}
            className="btn-ghost px-4 py-2.5 text-xs"
          >
            Clear
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await onLogDays([...marked].sort())
                setMarked(new Set())
              } finally {
                setSaving(false)
              }
            }}
            className="btn-primary py-2.5 text-xs"
          >
            {saving
              ? 'Logging…'
              : `OK — mark ${marked.size} day${marked.size === 1 ? '' : 's'} as commute · ${formatJPY(
                  marked.size * (cfg.fare || 0) * 2
                )}`}
          </button>
        </div>
      )}

      <p className="text-[10px] text-gray-400 dark:text-gray-500">
        Tap empty days to select them, then OK · tap a colored day to open & edit it ·{' '}
        <span className="text-indigo-500 dark:text-indigo-400">■ logged</span>{' '}
        <span className="text-amber-500 dark:text-amber-400">■ claimed</span>{' '}
        <span className="text-emerald-500 dark:text-emerald-400">■ reimbursed</span>{' '}
        <span className="text-rose-400">■ holiday</span> (auto-log skips 🇯🇵 holidays)
      </p>
    </div>
  )
}
// personal outings logged on that day.
function DaySheet({ dayKey, cfg, trips, pendingClaimIds, approvedClaimIds, onLogLeg, onAddOther, onEditTrip, onDeleteTrip, onClose }) {
  const [y, m, d] = dayKey.split('-').map(Number)
  const day = new Date(y, m - 1, d, 12)
  const [busy, setBusy] = useState(null)
  const otherTrips = trips.filter(isOtherTrip)

  return (
    <BottomSheet onClose={onClose} title={day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}>
      <div className="space-y-2">
        {COMMUTE_LEGS.map((leg) => {
          const trip = trips.find((t) => t.leg === leg.key)
          if (!trip) {
            return (
              <button
                key={leg.key}
                type="button"
                disabled={busy === leg.key}
                onClick={async () => {
                  setBusy(leg.key)
                  try {
                    await onLogLeg(leg, day)
                  } finally {
                    setBusy(null)
                  }
                }}
                className="flex w-full items-center justify-between rounded-xl border border-dashed border-gray-300 px-3 py-3 text-left text-sm text-gray-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-gray-400 dark:hover:text-indigo-400"
              >
                <span>
                  {leg.emoji} {leg.label}
                </span>
                <span className="text-xs font-semibold">
                  {busy === leg.key ? 'Logging…' : `+ Log ${formatJPY(cfg.fare)}`}
                </span>
              </button>
            )
          }
          const status = !trip.claimId
            ? { label: 'to claim', cls: 'text-amber-600 dark:text-amber-400' }
            : pendingClaimIds.has(trip.claimId)
              ? { label: '⏳ in a claim', cls: 'text-gray-500 dark:text-gray-400' }
              : approvedClaimIds.has(trip.claimId)
                ? { label: '✓ reimbursed', cls: 'text-emerald-600 dark:text-emerald-400' }
                : { label: '', cls: '' }
          return (
            <div
              key={leg.key}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-100/80 px-3 py-2.5 dark:border-transparent dark:bg-neutral-800/50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  {leg.emoji} {leg.label}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {trip.method || 'Pasmo'}
                  {trip.note && ` · ${trip.note}`}
                  {status.label && <span className={`font-medium ${status.cls}`}> · {status.label}</span>}
                </p>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {formatJPY(trip.amount)}
              </span>
              <div className="flex shrink-0">
                <button
                  type="button"
                  onClick={() => onEditTrip(trip)}
                  aria-label={`Edit ${leg.label}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-all hover:text-indigo-600 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-indigo-400"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteTrip(trip)}
                  aria-label={`Delete ${leg.label}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}

        {otherTrips.map((t) => {
          const disp = tripDisplay(t)
          const status = !t.reimbursable
            ? null
            : !t.claimId
              ? { label: '🏢 to claim', cls: 'text-amber-600 dark:text-amber-400' }
              : pendingClaimIds.has(t.claimId)
                ? { label: '⏳ in a claim', cls: 'text-gray-500 dark:text-gray-400' }
                : approvedClaimIds.has(t.claimId)
                  ? { label: '✓ reimbursed', cls: 'text-emerald-600 dark:text-emerald-400' }
                  : null
          return (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-100/80 px-3 py-2.5 dark:border-transparent dark:bg-neutral-800/50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                  {disp.emoji} {disp.label}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {t.method || 'Pasmo'}
                  {t.note && ` · ${t.note}`}
                  {status && <span className={`font-medium ${status.cls}`}> · {status.label}</span>}
                </p>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {formatJPY(t.amount)}
              </span>
              <div className="flex shrink-0">
                <button
                  type="button"
                  onClick={() => onEditTrip(t)}
                  aria-label={`Edit ${disp.label}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-all hover:text-indigo-600 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-indigo-400"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteTrip(t)}
                  aria-label={`Delete ${disp.label}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() => onAddOther(day)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 py-2.5 text-xs font-medium text-gray-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-gray-400 dark:hover:text-indigo-400"
        >
          🧳 Add another trip this day
        </button>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Deleting a trip also removes it from your main expense history. Days off? Just delete both
        legs and the day goes back to empty.
      </p>
    </BottomSheet>
  )
}

// First-run setup: fare + usual payment + auto weekday logging.
function SetupCard({ save }) {
  const [fare, setFare] = useState('280')
  const [method, setMethod] = useState('Pasmo')
  const [auto, setAuto] = useState(true)
  const [saving, setSaving] = useState(false)

  const start = async () => {
    setSaving(true)
    await save({
      commute: {
        enabled: true,
        fare: parseFloat(fare) || 280,
        method,
        auto,
        lastGenerated: null,
      },
    })
  }

  return (
    <div className="card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🚌 Commute tracker</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Logs your home → office and office → home bus runs every weekday, counts them in your
          spending, and handles the office reimbursement — tick trips, group them into a claim,
          and when it's approved the money books itself as income.
        </p>
      </div>
      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Fare for one way (¥)
        <input
          type="number"
          step="any"
          value={fare}
          onChange={(e) => setFare(e.target.value)}
          className="input"
        />
      </label>
      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <p>How do you usually pay?</p>
        <MethodPills value={method} onChange={setMethod} />
      </div>
      <label className="flex items-center gap-2.5 text-xs text-gray-600 dark:text-gray-300">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => setAuto(e.target.checked)}
          className="h-4 w-4 accent-indigo-600"
        />
        Log both trips automatically every weekday (holidays/leave: just delete that day)
      </label>
      <button type="button" disabled={saving} onClick={start} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Starting…' : 'Start tracking'}
      </button>
    </div>
  )
}

function SettingsCard({ cfg, save }) {
  const [fare, setFare] = useState(String(cfg.fare ?? 280))
  const [method, setMethod] = useState(cfg.method || 'Pasmo')
  const [auto, setAuto] = useState(cfg.auto !== false)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const apply = async () => {
    setSaving(true)
    await save({ commute: { ...cfg, fare: parseFloat(fare) || 280, method, auto } })
    setSaving(false)
    toast('✓ Commute settings saved')
  }

  return (
    <div className="card p-4 space-y-3">
      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Fare for one way (¥) — new trips only, old ones keep their amount
        <input type="number" step="any" value={fare} onChange={(e) => setFare(e.target.value)} className="input" />
      </label>
      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <p>Usual payment method</p>
        <MethodPills value={method} onChange={setMethod} />
      </div>
      <label className="flex items-center gap-2.5 text-xs text-gray-600 dark:text-gray-300">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => setAuto(e.target.checked)}
          className="h-4 w-4 accent-indigo-600"
        />
        Auto-log weekdays
      </label>
      <button type="button" disabled={saving} onClick={apply} className="btn-ghost w-full py-2 text-xs">
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  )
}

// Today at a glance: one tap logs a leg, tap again (on the ✓) to edit it.
// Below the office legs: today's personal outings + a button to add one.
function TodayCard({ cfg, todayTrips, onLog, onEdit, onAddOther }) {
  const [busy, setBusy] = useState(null)
  const otherToday = todayTrips.filter(isOtherTrip)
  return (
    <div className="card p-4 space-y-2.5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🚌 Today's trips</h2>
      <div className="grid grid-cols-2 gap-2">
        {COMMUTE_LEGS.map((leg) => {
          const logged = todayTrips.find((t) => t.leg === leg.key)
          return (
            <button
              key={leg.key}
              type="button"
              disabled={busy === leg.key}
              onClick={async () => {
                if (logged) {
                  onEdit(logged)
                  return
                }
                setBusy(leg.key)
                try {
                  await onLog(leg)
                } finally {
                  setBusy(null)
                }
              }}
              className={`rounded-xl border p-3 text-left transition-transform active:scale-[0.98] touch-manipulation ${
                logged
                  ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                  : 'border-gray-200 bg-gray-100/80 dark:border-transparent dark:bg-neutral-800/50'
              }`}
            >
              <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                {leg.emoji} {leg.label}
              </p>
              <p
                className={`text-sm font-bold tabular-nums ${
                  logged
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {logged
                  ? `✓ ${formatJPY(logged.amount)}`
                  : busy === leg.key
                    ? 'Logging…'
                    : `Tap to log · ${formatJPY(cfg.fare)}`}
              </p>
            </button>
          )
        })}
      </div>

      {otherToday.map((t) => {
        const d = tripDisplay(t)
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onEdit(t)}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-100/80 px-3 py-2.5 text-left dark:border-transparent dark:bg-neutral-800/50"
          >
            <span className="min-w-0 truncate text-xs font-medium text-gray-700 dark:text-gray-200">
              {d.emoji} {d.label}
              <span className="font-normal text-gray-500 dark:text-gray-400">
                {' '}· {t.method || 'Pasmo'}
                {t.reimbursable && ' · 🏢 claimable'}
              </span>
            </span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {formatJPY(t.amount)}
            </span>
          </button>
        )
      })}

      <button
        type="button"
        onClick={onAddOther}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 py-2.5 text-xs font-medium text-gray-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-gray-400 dark:hover:text-indigo-400"
      >
        🧳 Other trip — mall, station, weekend, anywhere
      </button>
    </div>
  )
}

// Add/edit one trip. Three kinds: the two office legs, or "other" — any
// personal outing (mall, station, weekend trip) with its own purpose text.
// `initial` without an id acts as a prefill for a brand-new trip.
const TRIP_KINDS = [...COMMUTE_LEGS, { key: OTHER_LEG, label: 'Other trip', emoji: '🧳' }]

function TripSheet({ cfg, initial, onSave, onClose }) {
  const { settings } = useSettings()
  const [leg, setLeg] = useState(initial?.leg ?? 'toOffice')
  // Other trips are logged as a route: from → to. Older trips only stored a
  // single `purpose` string, so fall those back into the destination field.
  const [fromPlace, setFromPlace] = useState(initial?.fromPlace ?? '')
  const [toPlace, setToPlace] = useState(initial?.toPlace ?? (initial?.fromPlace ? '' : initial?.purpose ?? ''))
  const [amount, setAmount] = useState(
    initial?.amount != null
      ? String(initial.amount)
      : initial?.leg === OTHER_LEG
        ? '' // personal outings have no standard fare — start blank
        : String(cfg.fare ?? 280)
  )
  const [method, setMethod] = useState(initial?.method ?? cfg.method ?? 'Pasmo')
  const [note, setNote] = useState(initial?.note ?? '')
  const [date, setDate] = useState(toDateInputValue(initial?.date))
  const [reimbursable, setReimbursable] = useState(
    initial ? initial.reimbursable === true || (initial.reimbursable !== false && initial.leg !== OTHER_LEG) : true
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isOther = leg === OTHER_LEG
  // Other trips can be paid from any account, not just the transit cards.
  const methods = isOther
    ? [...COMMUTE_METHODS, ...(settings?.accounts || []).map((a) => a.label).filter((l) => !COMMUTE_METHODS.includes(l))]
    : COMMUTE_METHODS

  const pickKind = (key) => {
    setLeg(key)
    // Sensible default only — the checkbox below can still flip it either way.
    if (!initial?.id) setReimbursable(key !== OTHER_LEG)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amountNum = parseFloat(amount) || 0
    if (amountNum <= 0) {
      setError('Enter the fare amount.')
      return
    }
    if (isOther && !toPlace.trim()) {
      setError('Where did this trip go? e.g. Kokura station, Mall')
      return
    }
    // A readable route string kept in sync with the two fields, so every
    // screen that already shows `purpose` (history, calendar) needs no change.
    const routeText = fromPlace.trim()
      ? `${fromPlace.trim()} → ${toPlace.trim()}`
      : toPlace.trim()
    setSaving(true)
    setError('')
    try {
      const parsedDate = parseDateInput(date)
      await onSave({
        date: parsedDate,
        dateKey: dateKey(parsedDate),
        leg,
        purpose: isOther ? routeText : null,
        fromPlace: isOther ? fromPlace.trim() : null,
        toPlace: isOther ? toPlace.trim() : null,
        amount: amountNum,
        method,
        note: note.trim(),
        reimbursable,
        claimId: initial?.claimId ?? null,
      })
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={initial?.id ? 'Edit trip' : 'Add trip'}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <p>What kind of trip?</p>
        <div className="grid grid-cols-3 gap-2">
          {TRIP_KINDS.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => pickKind(l.key)}
              className={`rounded-xl border py-2.5 text-xs font-semibold transition-transform active:scale-95 touch-manipulation ${
                leg === l.key
                  ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                  : 'border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
              }`}
            >
              {l.emoji} {l.label}
            </button>
          ))}
        </div>
      </div>

      {isOther && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            From
            <input
              value={fromPlace}
              onChange={(e) => setFromPlace(e.target.value)}
              placeholder="e.g. Home"
              className="input"
            />
          </label>
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            To
            <input
              value={toPlace}
              onChange={(e) => setToPlace(e.target.value)}
              placeholder="e.g. Kokura station"
              className="input"
            />
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Fare (¥)
          <input type="number" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
      </div>

      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <p>How did you pay?</p>
        <MethodPills value={method} onChange={setMethod} options={methods} />
      </div>

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        {isOther ? 'Note (optional)' : 'Route note (for the days you went a different way)'}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={isOther ? 'e.g. round trip with roommate' : 'e.g. via Kokura station, train + bus'}
          className="input"
        />
      </label>

      <label className="flex items-center gap-2.5 text-xs text-gray-600 dark:text-gray-300">
        <input
          type="checkbox"
          checked={reimbursable}
          onChange={(e) => setReimbursable(e.target.checked)}
          className="h-4 w-4 accent-indigo-600"
        />
        {isOther
          ? '🏢 Office pays this back (business errand) — joins the claim list'
          : '🏢 Office trip — the company reimburses this'}
      </label>

      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : 'Save trip'}
      </button>
    </BottomSheet>
  )
}

function MethodPills({ value, onChange, options = COMMUTE_METHODS }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
            value === m
              ? 'bg-indigo-600 text-white dark:bg-indigo-500'
              : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  )
}
