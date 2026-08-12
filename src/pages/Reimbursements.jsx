import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Camera, AlertTriangle, ChevronRight, Trash2, Pencil } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useSettings } from '../hooks/useSettings'
import { useBatchOps } from '../hooks/useBatchOps'
import { useToast } from '../context/ToastContext'
import { formatJPY, toDate, toDateInputValue, parseDateInput } from '../lib/format'
import { compressImage } from '../lib/imageCompress'
import { CLAIM_STAGES, claimStage, stageIndex, claimSpent, claimApproved, claimDifference, claimRejected } from '../lib/commute'
import {
  EXPENSE_TYPES,
  typeMeta,
  RECEIPT_REQUIRED_ABOVE,
  claimableLines,
  reportLines,
  sumLines,
  sumRequested,
  lineMarkup,
  reimbursementSummary,
} from '../lib/reimburse'
import { fundingSources } from '../lib/money'
import BottomSheet from '../components/ui/BottomSheet'
import Portal from '../components/ui/Portal'
import Skeleton from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'

const TABS = [
  { key: 'toClaim', label: 'To claim' },
  { key: 'reports', label: 'Reports' },
  { key: 'paid', label: 'Paid' },
]

// Everything the office owes you, from the receipt in your pocket to the money
// landing in your account. Expense lines get bundled into a report; the report
// walks draft → submitted → approved → paid, and only the last step books
// income, so nothing is counted before it's real.
export default function Reimbursements() {
  const items = useCollection('officeReimbursements')
  const trips = useCollection('commuteTrips')
  const claims = useCollection('commuteClaims')
  const { settings } = useSettings()
  const batchOps = useBatchOps()
  const { toast } = useToast()

  const [tab, setTab] = useState('toClaim')
  const [selected, setSelected] = useState(() => new Set())
  const [editing, setEditing] = useState(null) // {item} | {} for new
  const [openReport, setOpenReport] = useState(null)
  const [naming, setNaming] = useState(false)

  const loading = items.loading || trips.loading || claims.loading

  const lines = useMemo(
    () => claimableLines({ items: items.data, trips: trips.data }),
    [items.data, trips.data]
  )
  const summary = useMemo(
    () => reimbursementSummary({ items: items.data, trips: trips.data, claims: claims.data }),
    [items.data, trips.data, claims.data]
  )

  const selectedLines = lines.filter((l) => selected.has(l.id))
  const openReports = claims.data.filter((c) => claimStage(c) !== 'paid')
  const paidReports = claims.data.filter((c) => claimStage(c) === 'paid')

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // ---- Actions -------------------------------------------------------------

  // Bundle the ticked lines into a report. It starts as a DRAFT: nothing has
  // been handed over, so you can still add to it or take it apart.
  const createReport = async (name) => {
    const total = sumLines(selectedLines)
    await batchOps([
      {
        op: 'set',
        name: 'commuteClaims',
        data: {
          name: name.trim() || `Expense report ${toDateInputValue()}`,
          status: 'draft',
          // Snapshot of what it cost you, so the approved-vs-spent gap survives
          // even if the lines are edited later.
          claimedAmount: total,
          // What you actually asked the office for — can exceed the cost.
          requestedAmount: sumRequested(selectedLines),
          approvedAmount: null,
          date: new Date(),
        },
      },
      // Commute days link through every trip they contain.
      ...selectedLines.flatMap((l) =>
        l.kind === 'commute'
          ? l.tripIds.map((id) => ({
              op: 'update',
              name: 'commuteTrips',
              id,
              data: (ids) => ({ claimId: ids[0] }),
            }))
          : [
              {
                op: 'update',
                name: 'officeReimbursements',
                id: l.id,
                data: (ids) => ({ claimId: ids[0], status: 'applied' }),
              },
            ]
      ),
    ])
    setSelected(new Set())
    setNaming(false)
    setTab('reports')
    toast(`📝 Report created · ${formatJPY(total)} from ${selectedLines.length} line${selectedLines.length === 1 ? '' : 's'}`)
  }

  const submitReport = async (claim, total) => {
    await claims.update(claim.id, {
      status: 'submitted',
      claimedAmount: total,
      submittedAt: new Date(),
    })
    toast(`📤 “${claim.name}” submitted · ${formatJPY(total)}`)
  }

  // The office decided. What they approve may differ from what you spent —
  // that gap is the whole reason this is tracked line by line.
  const approveReport = async (claim, approvedAmount, spent) => {
    await claims.update(claim.id, {
      status: 'approved',
      approvedAmount,
      ...(claimSpent(claim) === null ? { claimedAmount: spent } : {}),
      approvedAt: new Date(),
    })
    const diff = approvedAmount - spent
    toast(
      diff > 0
        ? `✅ Approved ${formatJPY(approvedAmount)} — ${formatJPY(diff)} above cost`
        : diff < 0
          ? `✅ Approved ${formatJPY(approvedAmount)} — ${formatJPY(-diff)} short`
          : `✅ ${formatJPY(approvedAmount)} approved — waiting on the money`
    )
  }

  // Sent back for changes: it returns to draft with the reason attached, the
  // same as an expense system bouncing a report to your queue.
  const rejectReport = async (claim, reason) => {
    await claims.update(claim.id, {
      status: 'rejected',
      rejectedAt: new Date(),
      rejectionNote: reason.trim(),
    })
    toast(`↩ “${claim.name}” sent back — fix it and resubmit`)
  }

  // The money actually arrived. A separate payout books income into the
  // account it hit; "inside my salary" books nothing, because the salary
  // record already contains it and booking again would double-count.
  const markPaid = async (claim, lines_, account, via, receivedOn, amount) => {
    const total = Number.isFinite(amount) ? amount : claimApproved(claim) ?? sumLines(lines_)
    const withIncome = via !== 'salary'
    // The day the money actually landed, not the day you got round to ticking
    // it off — it's what the income entry is dated with, so it lands in the
    // right month on Charts and History.
    const paidOn = receivedOn instanceof Date && !isNaN(receivedOn) ? receivedOn : new Date()
    await batchOps([
      ...(withIncome
        ? [
            {
              op: 'set',
              name: 'income',
              data: {
                amount: total,
                source: 'Reimbursement',
                gross: null,
                net: null,
                note: `💼 ${claim.name} · ${lines_.length} line${lines_.length === 1 ? '' : 's'}`,
                account: account || null,
                country: 'JP', // the office reimburses in yen
                date: paidOn,
                claimId: claim.id,
              },
            },
          ]
        : []),
      ...lines_
        .filter((l) => l.kind === 'item')
        .map((l) => ({
          op: 'update',
          name: 'officeReimbursements',
          id: l.id,
          data: { status: 'received' },
        })),
      {
        op: 'update',
        name: 'commuteClaims',
        id: claim.id,
        data: (ids) => ({
          status: 'paid',
          approvedAmount: total,
          incomeId: withIncome ? ids[0] : null,
          receivedVia: via === 'salary' ? 'salary' : 'separate',
          paidAt: paidOn,
        }),
      },
    ])
    const diff = claimDifference({ ...claim, approvedAmount: total })
    toast(
      via === 'salary'
        ? `✓ ${formatJPY(total)} came with salary — nothing double-counted`
        : `💰 ${formatJPY(total)} booked${account ? ` into ${account}` : ' as income'}${
            diff > 0 ? ` · +${formatJPY(diff)} surplus` : ''
          }`
    )
    setOpenReport(null)
  }

  // The money didn't actually arrive after all (bounced payment, wrong report
  // ticked, they only said it was sent). Walks a paid report back to Approved:
  // the income it booked is deleted and its lines go back to "on a report".
  //
  // Both incomeId AND receivedVia must be cleared — claimStage() reads either
  // one as proof the money landed, so leaving either behind would keep the
  // report stuck on "paid" with nothing backing it.
  const reopenPaidReport = async (claim, lines_) => {
    await batchOps([
      ...(claim.incomeId ? [{ op: 'delete', name: 'income', id: claim.incomeId }] : []),
      ...lines_
        .filter((l) => l.kind === 'item')
        .map((l) => ({
          op: 'update',
          name: 'officeReimbursements',
          id: l.id,
          data: { status: 'applied' },
        })),
      {
        op: 'update',
        name: 'commuteClaims',
        id: claim.id,
        data: { status: 'approved', incomeId: null, receivedVia: null, paidAt: null },
      },
    ])
    setOpenReport(null)
    toast(
      claim.receivedVia === 'salary'
        ? `↩ “${claim.name}” back to approved — it was never booked as income anyway`
        : `↩ “${claim.name}” back to approved · ${formatJPY(claimApproved(claim) ?? 0)} of income removed`
    )
  }

  // Delete the report itself, at any stage. The expense lines are NOT deleted —
  // you still paid for those, so they go back to the claimable list ready for a
  // new report. Income booked by a paid report goes with it, otherwise deleting
  // the report would leave money in your books with nothing explaining it.
  const deleteReport = async (claim, lines_) => {
    const bookedIncome = Boolean(claim.incomeId)
    await batchOps([
      ...(bookedIncome ? [{ op: 'delete', name: 'income', id: claim.incomeId }] : []),
      ...lines_.flatMap((l) =>
        l.kind === 'commute'
          ? l.tripIds.map((id) => ({ op: 'update', name: 'commuteTrips', id, data: { claimId: null } }))
          : [{ op: 'update', name: 'officeReimbursements', id: l.id, data: { claimId: null, status: 'open' } }]
      ),
      { op: 'delete', name: 'commuteClaims', id: claim.id },
    ])
    setOpenReport(null)
    toast(
      `🗑 “${claim.name}” deleted · ${lines_.length} line${lines_.length === 1 ? '' : 's'} claimable again${
        bookedIncome ? ` · ${formatJPY(claimApproved(claim) ?? 0)} of income removed` : ''
      }`
    )
  }

  const saveItem = async (payload, id) => {
    if (id) {
      await items.update(id, payload)
      const onReport = items.data.find((i) => i.id === id)?.claimId
      if (onReport) {
        // Recompute from the freshly-saved values so the report's cost and
        // claimed totals never lag behind the lines they're made of.
        const updated = items.data.map((i) => (i.id === id ? { ...i, ...payload } : i))
        const lines_ = reportLines(onReport, { items: updated, trips: trips.data })
        const claim = claims.data.find((c) => c.id === onReport)
        const requested = sumRequested(lines_)
        // If the office approved exactly what you asked for (or hasn't decided
        // yet), a change to what you're claiming moves the approved figure with
        // it — otherwise the report would book a stale amount as income. An
        // approval that already differed is their decision: leave it alone.
        const followsRequest =
          claimStage(claim) !== 'paid' &&
          (!Number.isFinite(claim?.approvedAmount) ||
            claim.approvedAmount === (claim.requestedAmount ?? claim.claimedAmount))
        await claims.update(onReport, {
          claimedAmount: sumLines(lines_),
          requestedAmount: requested,
          ...(followsRequest && Number.isFinite(claim?.approvedAmount)
            ? { approvedAmount: requested }
            : {}),
        })
      }
      toast('✓ Expense updated')
    } else {
      await items.add({ ...payload, claimId: null, status: 'open' })
      toast(`✓ ${payload.item} · ${formatJPY(payload.amount)} added to claim`)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24 lg:mx-auto lg:max-w-2xl lg:pb-0">
      {/* ---- Where the money stands ---- */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            💼 Reimbursements
          </h1>
          {summary.surplus !== 0 && (
            <span
              className={`text-xs font-semibold ${
                summary.surplus > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-500 dark:text-red-400'
              }`}
            >
              {summary.surplus > 0 ? '+' : '−'}
              {formatJPY(Math.abs(summary.surplus))} lifetime{' '}
              {summary.surplus > 0 ? 'surplus' : 'shortfall'}
            </span>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">The office owes you</p>
          <p className="text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {formatJPY(summary.outstanding)}
          </p>
        </div>
        {/* Two across, not four — a yen amount needs the width to stay
            readable, and the label needs room for a real word. */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: '📥 To file', value: summary.toClaim, tone: 'amber' },
            { label: '📝 Draft', value: summary.draft },
            { label: '📤 Submitted', value: summary.submitted },
            { label: '✅ Approved', value: summary.approved, tone: 'emerald' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-gray-100/80 px-3 py-2.5 dark:bg-neutral-800/50">
              <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
              <p
                className={`text-base font-bold tabular-nums ${
                  s.value === 0
                    ? 'text-gray-400 dark:text-neutral-500'
                    : s.tone === 'amber'
                      ? 'text-amber-600 dark:text-amber-400'
                      : s.tone === 'emerald'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {formatJPY(s.value)}
              </p>
            </div>
          ))}
        </div>
        {summary.issueCount > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle size={14} className="shrink-0" />
            {summary.issueCount} line{summary.issueCount === 1 ? '' : 's'} need attention before
            you file
          </p>
        )}
      </div>

      {/* ---- Tabs ---- */}
      <div className="flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`min-h-11 flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-95 touch-manipulation ${
              tab === t.key
                ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                : 'border border-gray-300/60 bg-gray-100 text-gray-600 dark:border-transparent dark:bg-neutral-800 dark:text-gray-300'
            }`}
          >
            {t.label}
            {t.key === 'toClaim' && lines.length > 0 && ` · ${lines.length}`}
            {t.key === 'reports' && openReports.length > 0 && ` · ${openReports.length}`}
          </button>
        ))}
      </div>

      {/* ---- To claim: the lines not yet on any report ---- */}
      {tab === 'toClaim' && (
        <>
          <button
            type="button"
            onClick={() => setEditing({})}
            className="btn-primary flex min-h-12 w-full items-center justify-center gap-2 text-sm"
          >
            <Plus size={18} /> Add an expense
          </button>

          {lines.length === 0 ? (
            <EmptyState
              icon="🧾"
              message="Nothing waiting to be claimed. Add what you paid for out of your own pocket — commute days land here on their own."
              actionLabel="Add an expense"
              onAction={() => setEditing({})}
            />
          ) : (
            <>
              <div className="card divide-y divide-gray-200 overflow-hidden dark:divide-white/5">
                {lines.map((l) => (
                  <LineRow
                    key={l.id}
                    line={l}
                    checked={selected.has(l.id)}
                    onToggle={() => toggle(l.id)}
                    onEdit={
                      l.kind === 'item'
                        ? () => setEditing({ item: items.data.find((i) => i.id === l.id) })
                        : null
                    }
                  />
                ))}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Commute days come from the{' '}
                <Link to="/commute" className="text-indigo-500 underline">
                  Commute page
                </Link>{' '}
                — edit or delete them there.
              </p>
            </>
          )}
        </>
      )}

      {/* ---- Reports in flight ---- */}
      {tab === 'reports' && (
        <div className="space-y-3">
          {openReports.length === 0 ? (
            <EmptyState
              icon="📋"
              message="No open reports. Tick the expenses you want to claim and bundle them into one."
              actionLabel="Go to claimables"
              onAction={() => setTab('toClaim')}
            />
          ) : (
            openReports.map((c) => (
              <ReportCard
                key={c.id}
                claim={c}
                lines={reportLines(c.id, { items: items.data, trips: trips.data })}
                onOpen={() => setOpenReport(c.id)}
              />
            ))
          )}
        </div>
      )}

      {/* ---- Settled history ---- */}
      {tab === 'paid' && (
        <div className="space-y-3">
          {paidReports.length === 0 ? (
            <EmptyState icon="💰" message="Nothing paid back yet — reports land here once the money arrives." />
          ) : (
            paidReports.map((c) => (
              <ReportCard
                key={c.id}
                claim={c}
                lines={reportLines(c.id, { items: items.data, trips: trips.data })}
                onOpen={() => setOpenReport(c.id)}
              />
            ))
          )}
        </div>
      )}

      {/* ---- Sticky bar for the current selection ---- */}
      {tab === 'toClaim' && selectedLines.length > 0 && (
        // Portalled: the route transition's transform on the page wrapper would
        // otherwise pin this bar to the bottom of the list rather than the
        // bottom of the screen — see components/ui/Portal.jsx.
        <Portal>
          <div className="fixed inset-x-0 bottom-16 z-30 px-4 lg:bottom-4 lg:left-auto lg:right-8 lg:w-96 lg:px-0">
            <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedLines.length} line{selectedLines.length === 1 ? '' : 's'} selected
                </p>
                <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {formatJPY(sumRequested(selectedLines))}
                </p>
                {sumRequested(selectedLines) !== sumLines(selectedLines) && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    cost {formatJPY(sumLines(selectedLines))}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-medium text-gray-500 active:scale-95 dark:text-gray-400"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setNaming(true)}
                className="btn-primary min-h-11 shrink-0 px-4 text-sm"
              >
                Create report
              </button>
            </div>
          </div>
        </Portal>
      )}

      {naming && (
        <NameReportSheet
          total={sumRequested(selectedLines)}
          count={selectedLines.length}
          onCreate={createReport}
          onClose={() => setNaming(false)}
        />
      )}

      {openReport && (
        <ReportSheet
          claim={claims.data.find((c) => c.id === openReport)}
          lines={reportLines(openReport, { items: items.data, trips: trips.data })}
          accounts={settings?.accounts || []}
          onSubmit={submitReport}
          onApprove={approveReport}
          onReject={rejectReport}
          onPaid={markPaid}
          onReopen={reopenPaidReport}
          onDelete={deleteReport}
          onEditLine={(line) => setEditing({ item: items.data.find((i) => i.id === line.id) })}
          onClose={() => setOpenReport(null)}
        />
      )}

      {/* Rendered last so it layers above the report sheet when a line on an
          already-submitted report is opened for editing. */}
      {editing && (
        <ExpenseSheet
          initial={editing.item}
          accounts={settings?.accounts || []}
          onSave={saveItem}
          onDelete={
            editing.item
              ? async () => {
                  const claimId = editing.item.claimId
                  await items.remove(editing.item.id)
                  // Dropping a line off a report changes what that report is
                  // worth — recompute, or its totals describe a line that's gone.
                  if (claimId) {
                    const left = reportLines(claimId, {
                      items: items.data.filter((i) => i.id !== editing.item.id),
                      trips: trips.data,
                    })
                    await claims.update(claimId, {
                      claimedAmount: sumLines(left),
                      requestedAmount: sumRequested(left),
                    })
                  }
                  toast('🗑 Expense deleted')
                }
              : null
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ---- Pieces ----------------------------------------------------------------

// One claimable expense: tick it to put it on a report.
function LineRow({ line, checked, onToggle, onEdit }) {
  const meta = typeMeta(line.type)
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <button
        type="button"
        onClick={onToggle}
        aria-label={checked ? 'Deselect' : 'Select'}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-sm font-bold transition-transform active:scale-90 touch-manipulation ${
          checked
            ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
            : 'border-gray-300 dark:border-neutral-600'
        }`}
      >
        {checked ? '✓' : ''}
      </button>
      <button
        type="button"
        onClick={onEdit || onToggle}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <span aria-hidden="true" className="text-lg">{meta.emoji}</span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">
            {line.title}
            {line.vendor && <span className="font-normal text-gray-400"> · {line.vendor}</span>}
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            {line.date?.toLocaleDateString()} · {meta.label}
            {line.receipt && ' · 📎'}
            {lineMarkup(line) !== 0 && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {' '}· cost {formatJPY(line.amount)}, claiming {formatJPY(line.claimAmount)}
              </span>
            )}
          </span>
          {line.issues.length > 0 && (
            <span className="flex flex-wrap gap-1 pt-0.5">
              {line.issues.map((i) => (
                <span
                  key={i.key}
                  className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400"
                >
                  {i.label}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="shrink-0 text-base font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {formatJPY(line.claimAmount ?? line.amount)}
        </span>
      </button>
    </div>
  )
}

// A report at a glance: name, stage rail, and the money.
function ReportCard({ claim, lines, onOpen }) {
  const spent = claimSpent(claim) ?? sumLines(lines)
  const approved = claimApproved(claim)
  const diff = claimDifference(claim)
  return (
    <button type="button" onClick={onOpen} className="card w-full space-y-3 p-4 text-left">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
            {claim.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {lines.length} line{lines.length === 1 ? '' : 's'} ·{' '}
            {toDate(claim.date)?.toLocaleDateString()}
          </p>
        </div>
        <span className="shrink-0 text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {formatJPY(claimStage(claim) === 'draft' || claimStage(claim) === 'submitted' ? spent : approved ?? spent)}
        </span>
        <ChevronRight size={18} className="mt-1 shrink-0 text-gray-400" />
      </div>

      {claimRejected(claim) && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          ↩ Sent back{claim.rejectionNote ? `: ${claim.rejectionNote}` : ' for changes'}
        </p>
      )}

      <StageBar claim={claim} />

      {diff !== null && diff !== 0 && claimStage(claim) !== 'draft' && (
        <p
          className={`text-xs font-medium ${
            diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
          }`}
        >
          {diff > 0 ? '+' : '−'}
          {formatJPY(Math.abs(diff))} vs. the {formatJPY(spent)} you spent
        </p>
      )}
    </button>
  )
}

// Four labels side by side never fit a phone legibly, so the rail is four
// plain segments and the WORDS go underneath at a readable size — where
// there's room for the stage's meaning, not just its name.
function StageBar({ claim }) {
  const current = stageIndex(claim)
  const stage = CLAIM_STAGES[current]
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {CLAIM_STAGES.map((s, i) => (
          <span
            key={s.key}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < current
                ? 'bg-emerald-500'
                : i === current
                  ? 'bg-indigo-600 dark:bg-indigo-500'
                  : 'bg-gray-200 dark:bg-neutral-700'
            }`}
          />
        ))}
      </div>
      <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">
        {stage.icon} {stage.label}
        <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">
          · step {current + 1} of {CLAIM_STAGES.length} — {stage.hint}
        </span>
      </p>
    </div>
  )
}

// ---- Sheets ----------------------------------------------------------------

function NameReportSheet({ total, count, onCreate, onClose }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <BottomSheet
      as="form"
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        setError('')
        try {
          await onCreate(name)
        } catch (err) {
          // Say what went wrong. Silently re-enabling the button left the user
          // tapping it again on a report that was never going to be created.
          setError(err?.message || 'Could not create the report. Try again.')
          setSaving(false)
        }
      }}
      onClose={onClose}
      title="New expense report"
    >
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {count} line{count === 1 ? '' : 's'} · {formatJPY(total)}
      </p>
      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Report name
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. July commute & supplies"
          className="input"
        />
      </label>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        It starts as a draft — nothing is submitted until you say so, and you can take it apart
        any time before then.
      </p>
      <button type="submit" disabled={saving} className="btn-primary min-h-12 w-full text-sm">
        {saving ? 'Creating…' : 'Create draft report'}
      </button>
    </BottomSheet>
  )
}

// Add or edit one out-of-pocket expense — the line an office would ask you to
// justify: what, when, how much, who you paid, why, and the receipt.
function ExpenseSheet({ initial, accounts, onSave, onDelete, onClose }) {
  const [item, setItem] = useState(initial?.item ?? '')
  const [type, setType] = useState(initial?.type ?? 'other')
  const [vendor, setVendor] = useState(initial?.vendor ?? '')
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [claimAmount, setClaimAmount] = useState(initial?.claimAmount ?? '')
  const [date, setDate] = useState(toDateInputValue(initial?.date))
  const [purpose, setPurpose] = useState(initial?.purpose ?? initial?.note ?? '')
  const [paidWith, setPaidWith] = useState(initial?.paidWith ?? 'Cash')
  const [receipt, setReceipt] = useState(initial?.receipt ?? null)
  const [imageBusy, setImageBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const amountNum = parseFloat(amount) || 0
  // Blank means "claim exactly what it cost" — the normal case.
  const claimNum = claimAmount === '' ? amountNum : parseFloat(claimAmount) || 0
  const markup = claimNum - amountNum
  const needsReceipt = amountNum > RECEIPT_REQUIRED_ABOVE && !receipt

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImageBusy(true)
    setError('')
    try {
      setReceipt(await compressImage(file))
    } catch (err) {
      setError(err.message || 'Could not read that photo.')
    } finally {
      setImageBusy(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!item.trim() || amountNum <= 0) {
      setError('What you bought and the amount are both required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(
        {
          item: item.trim(),
          type,
          vendor: vendor.trim(),
          amount: amountNum,
          claimAmount: claimNum,
          date: parseDateInput(date),
          purpose: purpose.trim(),
          note: purpose.trim(), // keeps older screens that read `note` working
          paidWith,
          receipt,
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
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={initial ? 'Edit expense' : 'Claimable expense'}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          It cost you (¥)
          <input
            type="number"
            step="any"
            required
            autoFocus={!initial}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input"
          />
        </label>
        {/* Claiming more than it cost is the whole point of tracking both:
            if the office approves it, the gap is profit. Blank = same. */}
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          You're claiming (¥)
          <input
            type="number"
            step="any"
            placeholder={amountNum > 0 ? String(amountNum) : 'same as cost'}
            value={claimAmount}
            onChange={(e) => setClaimAmount(e.target.value)}
            className="input"
          />
        </label>
      </div>

      {markup !== 0 && amountNum > 0 && (
        <p
          className={`rounded-xl px-3 py-2 text-xs ${
            markup > 0
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          }`}
        >
          {markup > 0
            ? `Asking ${formatJPY(markup)} more than it cost — that's profit if they approve it.`
            : `Asking ${formatJPY(-markup)} less than it cost — you'd be out of pocket by that much.`}
        </p>
      )}

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
      </label>

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        What was it?
        <input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="e.g. Printer paper, taxi to client"
          required
          className="input"
        />
      </label>

      {/* Expense type — what an office needs to book it to a budget */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">Expense type</p>
        <div className="flex flex-wrap gap-2">
          {EXPENSE_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(t.key)}
              className={`min-h-9 rounded-full px-3 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                type === t.key
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                  : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
              }`}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Vendor / shop
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Paid with
          <select value={paidWith} onChange={(e) => setPaidWith(e.target.value)} className="input">
            {/* Yen accounts only: the office reimburses in yen, so fronting a
                claim from an Indian account would take rupees off it. */}
            {fundingSources(accounts, 'JP').map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
            <option value="Pasmo">Pasmo</option>
            <option value="Other">Other</option>
          </select>
        </label>
      </div>

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Business purpose
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="Why the office should pay for it"
          className="input"
        />
      </label>

      {/* Receipt: the thing reports get sent back for */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Receipt</span>
          {needsReceipt && (
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              Required above {formatJPY(RECEIPT_REQUIRED_ABOVE)}
            </span>
          )}
        </div>
        {receipt ? (
          <div className="space-y-2">
            <img
              src={receipt}
              alt="Receipt"
              className="max-h-48 w-full rounded-xl object-contain dark:bg-neutral-800"
            />
            <button
              type="button"
              onClick={() => setReceipt(null)}
              className="min-h-9 text-sm font-medium text-red-500 active:scale-95 dark:text-red-400"
            >
              Remove photo
            </button>
          </div>
        ) : (
          <label
            className={`flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-medium transition-colors touch-manipulation ${
              needsReceipt
                ? 'border-amber-400 text-amber-600 dark:text-amber-400'
                : 'border-gray-300 text-gray-500 dark:border-neutral-700 dark:text-gray-400'
            }`}
          >
            <Camera size={17} />
            {imageBusy ? 'Compressing…' : 'Snap or pick the receipt'}
            <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
          </label>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        {paidWith === 'Other'
          ? "Not counted as your spending — it's the office's money. It becomes income when a report containing it is paid."
          : `Comes off ${paidWith === 'Cash' ? 'your cash on hand' : paidWith} now, because that's where the money went, and returns as income when a report containing it is paid. It never counts as your own spending.`}
      </p>

      <button type="submit" disabled={saving || imageBusy} className="btn-primary min-h-12 w-full text-sm">
        {saving ? 'Saving…' : initial ? 'Save changes' : 'Add to claim list'}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={async () => {
            await onDelete()
            onClose()
          }}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 text-sm font-medium text-red-500 active:scale-95 dark:text-red-400"
        >
          <Trash2 size={15} /> Delete this expense
        </button>
      )}
    </BottomSheet>
  )
}

// The report itself: its lines, and whichever action its stage allows.
function ReportSheet({ claim, lines, accounts, onSubmit, onApprove, onReject, onPaid, onReopen, onDelete, onEditLine, onClose }) {
  const stage = claimStage(claim)
  // Once the money has arrived the figures are history — don't let them move.
  const editable = stage !== 'paid'
  const spent = claimSpent(claim) ?? sumLines(lines)
  // What you asked for, which may be more than it cost you.
  // Live from the lines, so changing what you're claiming on any line moves
  // the report total straight away. The stored figure is only a fallback for
  // a report whose lines have since been deleted.
  const requested = lines.length ? sumRequested(lines) : (claim.requestedAmount ?? spent)
  const [approvedInput, setApprovedInput] = useState(String(claimApproved(claim) ?? requested))
  // What will actually be booked as income: the approved figure as it stands in
  // the box, not what it cost you.
  const payout = approvedInput === '' ? 0 : parseFloat(approvedInput) || 0
  const [rejectReason, setRejectReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [account, setAccount] = useState(accounts[0]?.label || '')
  const [via, setVia] = useState('separate')
  // The day the money hit the account — often not today, so it's yours to set.
  const [receivedOn, setReceivedOn] = useState(toDateInputValue())
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      // These actions delete income and re-link lines. A rejected write that
      // reported nothing looked exactly like one that worked.
      setError(err?.message || 'Could not save that. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet onClose={onClose} title={claim.name}>
      <StageBar claim={claim} />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {claimRejected(claim) && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          ↩ Sent back{claim.rejectionNote ? `: ${claim.rejectionNote}` : ' for changes'}
        </p>
      )}

      {/* The lines, so the total is never a mystery number. Typed lines stay
          editable until the money has landed — that's how you record claiming
          more than something cost, including on a report already sent in. */}
      {editable && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Tap a line to change what it cost or what you're claiming for it.
        </p>
      )}
      <div className="max-h-[32svh] divide-y divide-gray-200/70 overflow-y-auto dark:divide-white/5">
        {lines.map((l) => {
          const markup = lineMarkup(l)
          const canEdit = editable && l.kind === 'item'
          const Row = canEdit ? 'button' : 'div'
          return (
            <Row
              key={l.id}
              {...(canEdit ? { type: 'button', onClick: () => onEditLine(l) } : {})}
              className="flex w-full items-center gap-2.5 py-2.5 text-left"
            >
              <span aria-hidden="true" className="text-base">{typeMeta(l.type).emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-700 dark:text-gray-200">
                  {l.title}
                  {l.receipt && ' 📎'}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {l.date?.toLocaleDateString()}
                  {markup !== 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {' '}· cost {formatJPY(l.amount)}, claiming {formatJPY(l.claimAmount)}
                    </span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {formatJPY(l.claimAmount ?? l.amount)}
              </span>
              {canEdit && <Pencil size={13} className="shrink-0 text-gray-400" />}
            </Row>
          )
        })}
      </div>

      <div className="space-y-1 rounded-xl bg-gray-100/80 px-3 py-2.5 dark:bg-neutral-800/50">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">You spent</span>
          <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {formatJPY(spent)}
          </span>
        </div>
        {requested !== spent && (
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">You're claiming</span>
            <span className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatJPY(requested)}
            </span>
          </div>
        )}
      </div>

      {/* Stage 1 → 2 */}
      {stage === 'draft' && (
        <button
          type="button"
          disabled={busy || lines.length === 0}
          onClick={() => run(() => onSubmit(claim, spent))}
          className="btn-primary min-h-12 w-full text-sm"
        >
          📤 Submit to the office
        </button>
      )}

      {/* Stage 2 → 3 (or back) */}
      {stage === 'submitted' && (
        <div className="space-y-2">
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Amount they approved (¥)
            <input
              type="number"
              step="any"
              value={approvedInput}
              onChange={(e) => setApprovedInput(e.target.value)}
              className="input"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => onApprove(claim, parseFloat(approvedInput) || 0, spent))}
            className="btn-primary min-h-12 w-full text-sm"
          >
            ✅ Mark approved
          </button>
          {rejecting ? (
            <div className="space-y-2">
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="What did they ask you to fix?"
                className="input"
                autoFocus
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => onReject(claim, rejectReason))}
                className="min-h-11 w-full rounded-xl border border-red-300 text-sm font-semibold text-red-600 active:scale-95 dark:border-red-500/40 dark:text-red-400"
              >
                Send it back to draft
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRejecting(true)}
              className="min-h-11 w-full text-sm font-medium text-gray-500 active:scale-95 dark:text-gray-400"
            >
              They sent it back instead
            </button>
          )}
        </div>
      )}

      {/* Stage 3 → 4: the money lands */}
      {stage === 'approved' && (
        <div className="space-y-2.5">
          {/* Editable right up to the moment it's booked: what the office
              actually pays is only certain once it's in the account, and this
              figure — not the cost — is what becomes income. */}
          <label className="block text-xs text-emerald-700 space-y-1 dark:text-emerald-400">
            Approved — the amount they're paying you (¥)
            <input
              type="number"
              step="any"
              value={approvedInput}
              onChange={(e) => setApprovedInput(e.target.value)}
              className="input"
            />
          </label>
          {payout !== requested && (
            <button
              type="button"
              onClick={() => setApprovedInput(String(requested))}
              className="w-full rounded-xl bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-700 active:scale-95 dark:text-amber-400"
            >
              ⚠ You're claiming {formatJPY(requested)} but this books{' '}
              {formatJPY(payout)}. Tap to use the claimed amount.
            </button>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">How did the money arrive?</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'separate', label: '💰 Separate payout' },
              { key: 'salary', label: '🧾 Inside my salary' },
            ].map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setVia(o.key)}
                className={`min-h-12 rounded-xl border text-sm font-semibold transition-transform active:scale-95 touch-manipulation ${
                  via === o.key
                    ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                    : 'border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {via === 'separate' && accounts.length > 0 && (
            <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
              Into which account
              <select value={account} onChange={(e) => setAccount(e.target.value)} className="input">
                {accounts.map((a) => (
                  <option key={a.id} value={a.label}>
                    {a.label}
                  </option>
                ))}
                <option value="Cash">Cash</option>
              </select>
            </label>
          )}
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            When did it arrive?
            <input
              type="date"
              value={receivedOn}
              max={toDateInputValue()}
              onChange={(e) => setReceivedOn(e.target.value)}
              className="input"
            />
          </label>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {via === 'salary'
              ? 'No income is booked — your salary entry already contains it, and booking it twice would inflate your month.'
              : `Books ${formatJPY(payout)} of income${account ? ` into ${account}` : ''} on ${
                  parseDateInput(receivedOn)?.toLocaleDateString() ?? 'today'
                }.`}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() =>
                onPaid(
                  claim,
                  lines,
                  via === 'separate' ? account : null,
                  via,
                  parseDateInput(receivedOn),
                  payout
                )
              )
            }
            className="btn-primary min-h-12 w-full text-sm"
          >
            💰 Money received
          </button>
        </div>
      )}

      {stage === 'paid' && (
        <div className="space-y-1.5 rounded-xl bg-emerald-500/10 px-3 py-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-emerald-700 dark:text-emerald-400">
              Received {claim.receivedVia === 'salary' ? 'with salary' : 'as a payout'}
            </span>
            <span className="text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatJPY(claimApproved(claim))}
            </span>
          </div>
          {claimDifference(claim) !== null && claimDifference(claim) !== 0 && (
            <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
              {claimDifference(claim) > 0 ? '+' : '−'}
              {formatJPY(Math.abs(claimDifference(claim)))} vs. the {formatJPY(spent)} you spent
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {toDate(claim.paidAt)?.toLocaleDateString()}
          </p>
        </div>
      )}

      {/* It said paid, but the money never showed up — walk it back rather
          than leaving income in your books that you never received. */}
      {stage === 'paid' && (
        <div className="space-y-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirmReopen ? run(() => onReopen(claim, lines)) : setConfirmReopen(true))}
            className={`min-h-11 w-full rounded-xl border text-sm font-semibold transition-transform active:scale-95 touch-manipulation ${
              confirmReopen
                ? 'border-red-400 bg-red-500/10 text-red-600 dark:border-red-500/40 dark:text-red-400'
                : 'border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
            }`}
          >
            {confirmReopen ? 'Tap again — undo the payment' : "↩ Money didn't actually arrive"}
          </button>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {claim.receivedVia === 'salary'
              ? 'Puts the report back to Approved. Nothing was booked as income, so nothing else changes.'
              : `Puts the report back to Approved and deletes the ${formatJPY(
                  claimApproved(claim) ?? 0
                )} of income it booked${claim.incomeId ? '' : ' (already gone)'}.`}
          </p>
        </div>
      )}

      {/* Available at every stage — a report can be wrong at any point, and
          being stuck with one you can't remove is worse than the risk of
          removing it. The lines survive; only the report goes. */}
      <div className="space-y-1.5 border-t border-gray-200/70 pt-3 dark:border-white/5">
        <button
          type="button"
          disabled={busy}
          onClick={() => (confirmDelete ? run(() => onDelete(claim, lines)) : setConfirmDelete(true))}
          className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-transform active:scale-95 touch-manipulation ${
            confirmDelete
              ? 'border border-red-400 bg-red-500/10 text-red-600 dark:border-red-500/40 dark:text-red-400'
              : 'text-red-500 dark:text-red-400'
          }`}
        >
          <Trash2 size={14} />
          {confirmDelete ? 'Tap again — delete this report' : 'Delete this report'}
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {lines.length} line{lines.length === 1 ? '' : 's'} go back to the claimable list — nothing
          you paid for is lost.
          {claim.incomeId ? ` The ${formatJPY(claimApproved(claim) ?? 0)} of income it booked is deleted too.` : ''}
        </p>
      </div>
    </BottomSheet>
  )
}
