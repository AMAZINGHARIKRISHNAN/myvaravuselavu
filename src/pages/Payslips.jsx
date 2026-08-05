import { useMemo, useRef, useState } from 'react'
import { Upload, Loader2, TriangleAlert, Trash2, Bus } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useToast } from '../context/ToastContext'
import { compressImage } from '../lib/imageCompress'
import { extractPayslip } from '../lib/payslipExtract'
import { aiEnabled, isAvailable } from '../lib/ai'
import { formatJPY } from '../lib/format'

import {
  ALLOWANCE_KEYS, DEDUCTION_KEYS, LINE_LABELS,
  normalizePayslip, checkConsistency, takeHomeRate,
  comparePayslips, detectSteps, deductionTrends, commuteGap, byPeriod,
  payslipFileKind,
} from '../lib/payslip'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'

// Payslips: upload one a month, and let the differences between them talk.
//
// A slip is stored on the INCOME record it describes — same collection the
// salary already lands in, with the breakdown attached. No new collection, so
// backups and CSV keep working untouched.
const periodLabel = (period) => {
  const [y, m] = String(period || '').split('-')
  if (!y || !m) return period || '—'
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', {
    month: 'short', year: 'numeric',
  })
}

// PDFs go to the model as-is; there is nothing to resize.
const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('could not read that file'))
    reader.readAsDataURL(file)
  })

const yen = (n) => formatJPY(Math.round(n || 0))
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${yen(Math.abs(n))}`

export default function Payslips() {
  const income = useCollection('income')
  const trips = useCollection('commuteTrips')
  const { toast } = useToast()
  const fileRef = useRef(null)

  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(null) // { payslip, ok, problems }
  const [saving, setSaving] = useState(false)

  // Every income record that carries a payslip breakdown.
  const slips = useMemo(
    () => byPeriod(income.data.filter((r) => r.payslip).map((r) => ({ ...r.payslip, id: r.id }))),
    [income.data]
  )

  const rows = useMemo(() => comparePayslips(slips).reverse(), [slips])
  const steps = useMemo(() => detectSteps(slips), [slips])
  const trends = useMemo(() => deductionTrends(slips), [slips])

  // What commuting actually cost in the latest slip's month — the app already
  // knows this to the yen, which is what makes the allowance comparison possible.
  const latest = slips[slips.length - 1]
  const commute = useMemo(() => {
    if (!latest) return null
    const monthTrips = trips.data.filter((t) => String(t.dateKey || '').startsWith(latest.period))
    const cost = monthTrips.reduce((s, t) => s + (t.fare || 0), 0)
    return commuteGap(latest, cost)
  }, [latest, trips.data])

  const pick = () => fileRef.current?.click()

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // let the same file be chosen twice
    if (!file) return

    if (!aiEnabled('payslips')) {
      toast('Turn on Payslip reading in Settings → AI first')
      return
    }
    if (!isAvailable('payslips')) {
      toast('Payslip reading needs a connection')
      return
    }

    const kind = payslipFileKind(file)
    if (kind === 'unsupported') {
      toast('Upload a PDF or a photo of the payslip')
      return
    }
    if (kind === 'pdf-too-big') {
      toast('That PDF is too large — send a photo of it instead')
      return
    }

    setBusy(true)
    try {
      // A payroll-portal PDF is text, so it goes through untouched and reads far
      // more reliably than a photograph. Only photographs get compressed.
      // Neither is stored — only the figures below.
      const dataUrl = kind === 'pdf' ? await readAsDataUrl(file) : await compressImage(file)
      const result = await extractPayslip(dataUrl)
      setDraft(result)
      if (!result.ok) toast('Read it, but the numbers do not add up — check below')
    } catch (error) {
      toast(`Could not read that payslip — ${String(error.message || error).replace(/^ai: /, '')}`)
    } finally {
      setBusy(false)
    }
  }

  // Editing a line re-runs the consistency check, so the warning clears as soon
  // as the figure is corrected.
  const editLine = (side, key, value) => {
    setDraft((d) => {
      const next = normalizePayslip({
        ...d.payslip,
        [side]: { ...d.payslip[side], [key]: value },
      })
      return { payslip: next, ...checkConsistency(next) }
    })
  }

  const editTotal = (field, value) => {
    setDraft((d) => {
      const next = normalizePayslip({ ...d.payslip, [field]: value })
      return { payslip: next, ...checkConsistency(next) }
    })
  }

  const save = async () => {
    const p = draft.payslip
    const existing = income.data.find((r) => r.payslip?.period === p.period)
    setSaving(true)
    try {
      const [year, month] = p.period.split('-').map(Number)
      const record = {
        amount: p.net,
        source: 'Salary',
        gross: p.gross,
        net: p.net,
        payslip: p,
        date: new Date(year, month - 1, 25),
        note: `Payslip ${p.period}`,
      }
      // One slip per month: re-uploading a month corrects it rather than
      // stacking a second salary on top of the first.
      if (existing) await income.update(existing.id, record)
      else await income.add(record)
      toast(existing ? `✓ ${periodLabel(p.period)} updated` : `✓ ${periodLabel(p.period)} saved`)
      setDraft(null)
    } catch {
      toast('Could not save that payslip')
    } finally {
      setSaving(false)
    }
  }

  const removeSlip = async (period) => {
    const existing = income.data.find((r) => r.payslip?.period === period)
    if (!existing) return
    await income.remove(existing.id)
    toast(`Removed ${periodLabel(period)}`)
  }

  return (
    <div className="space-y-5 pb-16 lg:pb-0">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">Payslips</h1>
        <p className="text-xs text-gray-400">
          Upload one a month. The differences between them are the useful part.
        </p>
      </div>

      {/* ---- Upload ---- */}
      <div className="card space-y-3 p-4">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={handleFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {busy ? 'Reading the payslip…' : 'Upload a payslip'}
        </button>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          PDF or photo. A PDF from the payroll portal reads most accurately. The file is sent
          to Gemini to be read, then discarded — only the figures are kept.
          {!aiEnabled('payslips') && ' Turn on Payslip reading in Settings → AI (Gemini) first.'}
        </p>
      </div>

      {/* ---- Confirm before anything is written ---- */}
      {draft && (
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {periodLabel(draft.payslip.period)} — check before saving
            </h2>
            <span className="text-xs tabular-nums text-gray-500">
              take-home {Math.round(takeHomeRate(draft.payslip) * 100) || 0}%
            </span>
          </div>

          {!draft.ok && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
              <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                <TriangleAlert size={12} className="mt-px shrink-0" />
                <span>
                  {draft.problems.join(' ')} Correct the wrong line below — a slip that does not
                  add up would skew every comparison after it.
                </span>
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Column
              title="Payments"
              keys={ALLOWANCE_KEYS}
              values={draft.payslip.allowances}
              onEdit={(k, v) => editLine('allowances', k, v)}
              total={draft.payslip.gross}
              totalLabel="総支給額 gross"
              onTotal={(v) => editTotal('gross', v)}
            />
            <Column
              title="Deductions"
              keys={DEDUCTION_KEYS}
              values={draft.payslip.deductions}
              onEdit={(k, v) => editLine('deductions', k, v)}
              total={draft.payslip.net}
              totalLabel="差引支給額 net"
              onTotal={(v) => editTotal('net', v)}
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !draft.payslip.period}
              className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : draft.ok ? 'Save payslip' : 'Save anyway'}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="btn-ghost px-4 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {income.loading && <Skeleton className="h-32 w-full" />}

      {!income.loading && slips.length === 0 && !draft && (
        <EmptyState icon="🧾" message="No payslips yet — upload one to start" />
      )}

      {/* ---- What changed ---- */}
      {steps.length > 0 && (
        <div className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Rate changes
          </h2>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            A deduction that jumped and stayed jumped — a new rate, not a one-off.
          </p>
          {steps.map((s) => (
            <div
              key={`${s.key}-${s.period}`}
              className="flex items-baseline justify-between gap-2 border-t border-gray-200/70 pt-2 text-xs dark:border-white/5"
            >
              <span className="min-w-0">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {LINE_LABELS[s.key].en}
                </span>
                <span className="text-gray-400"> {LINE_LABELS[s.key].ja}</span>
                <span className="block text-[11px] text-gray-500">
                  from {periodLabel(s.period)}
                  {s.provisional && ' · not yet confirmed by a later month'}
                </span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className={s.change > 0 ? 'text-red-500' : 'text-emerald-500'}>
                  {signed(s.change)}/mo
                </span>
                <span className="block text-[11px] text-gray-500">
                  {signed(s.annualImpact)} a year
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- The figure only this app can produce ---- */}
      {commute && (
        <div className="card space-y-1 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            <Bus size={15} aria-hidden="true" /> Commuting allowance vs actual
          </h2>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {periodLabel(latest.period)} · allowance {yen(commute.allowance)} against{' '}
            {yen(commute.actual)} of logged trips
          </p>
          <p
            className={`text-lg font-bold tabular-nums ${
              commute.coversIt ? 'text-emerald-500' : 'text-red-500'
            }`}
          >
            {signed(commute.gap)}
          </p>
        </div>
      )}

      {/* ---- Where the money goes ---- */}
      {trends.length > 0 && (
        <div className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Deductions · {periodLabel(slips[0].period)} → {periodLabel(latest.period)}
          </h2>
          {trends.map((t) => (
            <div key={t.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">
                  {t.label.en} <span className="text-gray-400">{t.label.ja}</span>
                </span>
                <span className="shrink-0 tabular-nums text-gray-500">
                  {yen(t.to)}
                  {t.change !== 0 && (
                    <span className={t.change > 0 ? ' text-red-500' : ' text-emerald-500'}>
                      {' '}{signed(t.change)}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.min(100, t.share * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- Month by month ---- */}
      {rows.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Month by month
          </h2>
          <div className="space-y-2">
            {rows.map((r) => (
              <div
                key={r.period}
                className="flex items-center gap-3 border-t border-gray-200/70 pt-2 text-xs dark:border-white/5"
              >
                <span className="w-20 shrink-0 font-medium text-gray-900 dark:text-gray-100">
                  {periodLabel(r.period)}
                </span>
                <span className="min-w-0 flex-1 tabular-nums text-gray-500">
                  {yen(r.gross)} gross · {yen(r.deductionsTotal)} taken
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{yen(r.net)}</span>
                  {r.netDelta !== 0 && (
                    <span
                      className={`block text-[11px] ${
                        r.netDelta > 0 ? 'text-emerald-500' : 'text-red-500'
                      }`}
                    >
                      {signed(r.netDelta)}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => removeSlip(r.period)}
                  aria-label={`Remove ${periodLabel(r.period)}`}
                  className="shrink-0 text-gray-400 transition-colors hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// One side of the slip, every line editable — the extraction is a first draft,
// not an authority.
function Column({ title, keys, values, onEdit, total, totalLabel, onTotal }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">{title}</p>
      {keys.map((k) => (
        <label key={k} className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">
            {LINE_LABELS[k].en} <span className="text-gray-400">{LINE_LABELS[k].ja}</span>
          </span>
          <input
            type="number"
            inputMode="numeric"
            value={values[k] || 0}
            onChange={(e) => onEdit(k, e.target.value)}
            className="input w-24 shrink-0 py-1 text-right text-xs"
          />
        </label>
      ))}
      <label className="flex items-center gap-2 border-t border-gray-200/70 pt-1.5 text-xs dark:border-white/5">
        <span className="min-w-0 flex-1 truncate font-semibold text-gray-900 dark:text-gray-100">
          {totalLabel}
        </span>
        <input
          type="number"
          inputMode="numeric"
          value={total || 0}
          onChange={(e) => onTotal(e.target.value)}
          className="input w-24 shrink-0 py-1 text-right text-xs font-semibold"
        />
      </label>
    </div>
  )
}
