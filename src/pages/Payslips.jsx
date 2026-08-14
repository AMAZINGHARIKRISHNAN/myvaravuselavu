import { useMemo, useRef, useState } from 'react'
import { Upload, Loader2, TriangleAlert, Trash2, Send, Pencil } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useToast } from '../context/ToastContext'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { compressImage } from '../lib/imageCompress'
import { extractPayslip } from '../lib/payslipExtract'
import { aiEnabled, isAvailable } from '../lib/ai'
import { formatJPY, formatINR } from '../lib/format'
import { readPayslipPdf, checkParsedPayslip, toNumber } from '../lib/payslipParse'
import { englishFor } from '../lib/payslipTerms'
import { payslipFileKind } from '../lib/payslip'
import {
  monthlyPayAndSend,
  sendingSummary,
  compareSlips,
  detectDeductionSteps,
  netOf,
  grossOf,
} from '../lib/payslipAnalysis'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'
import BottomSheet from '../components/ui/BottomSheet'

// Payslips: upload one a month, keep the figures, throw the file away.
//
// The slip is read ON THIS DEVICE. A payroll PDF is real text at known
// coordinates, so lib/payslipParse.js reads it exactly — offline, free, and
// unable to invent a number, which matters more here than anywhere else in the
// app. Gemini is only a fallback for a scan or a layout the parser does not
// recognise, and typing it in by hand is the fallback after that.
//
// Every line is stored exactly as the employer printed it, with an English
// gloss beside it. Forcing this employer's 支度金 and 社宅使用料 into a tidy
// fixed schema would file most of the slip under "Other".
//
// A slip lives on the INCOME record it describes — the same collection the
// salary lands in — so backups and CSV keep working untouched.

const periodLabel = (period) => {
  const [y, m] = String(period || '').split('-')
  if (!y || !m) return period || '—'
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
  })
}

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('could not read that file'))
    reader.readAsDataURL(file)
  })

const yen = (n) => formatJPY(Math.round(n || 0))
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${yen(Math.abs(n))}`

// The AI path returns the old fixed-key shape; reshape it into lines so the
// rest of this screen only ever deals with one format.
function fromAiShape(p) {
  const lines = (map, side) =>
    Object.entries(map || {})
      .filter(([, v]) => Number.isFinite(v) && v !== 0)
      .map(([k, amount]) => ({ ja: k, en: englishFor(k) || k, amount, side }))
  return {
    period: p.period,
    payments: lines(p.allowances, 'payments'),
    deductions: lines(p.deductions, 'deductions'),
    attendance: [],
    totals: {
      gross: p.gross,
      net: p.net,
      deductions: Object.values(p.deductions || {}).reduce((s, v) => s + (v || 0), 0),
    },
  }
}

// Only the figures are kept. The parser's own bookkeeping (ok / reason /
// parsed) never reaches the database, and neither does the file it came from.
const stripMeta = (parsed) => ({
  period: parsed.period,
  payments: parsed.payments,
  deductions: parsed.deductions,
  attendance: parsed.attendance,
  totals: parsed.totals,
})

// Payslips arrive for the month just gone, so that is the month to open on —
// an empty month field renders as "---------  ----", which reads as broken
// rather than as waiting for you.
const lastMonth = () => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Amounts start EMPTY, not at 0. A zero in a money field looks like a figure
// somebody entered, and on a payslip that is exactly the confusion to avoid.
const blankSlip = () => ({
  period: lastMonth(),
  payments: [{ ja: '基本給', en: 'Base pay', amount: null }],
  deductions: [{ ja: '所得税', en: 'Income tax', amount: null }],
  attendance: [],
  totals: {},
})

export default function Payslips() {
  const income = useCollection('income')
  const transfers = useCollection('transfers')
  // Yen spending for the same months, so "what was left" is a real figure
  // rather than take-home minus remittances.
  const expenses = useCollection('expenses')
  const { toast } = useToast()
  const fileRef = useRef(null)

  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(null) // { slip, problems[], source }
  const [saving, setSaving] = useState(false)
  const [openMonth, setOpenMonth] = useState(null)

  const slips = useMemo(
    () =>
      income.data
        .filter((r) => r.payslip?.period)
        .map((r) => ({ ...r.payslip, id: r.id }))
        .sort((a, b) => a.period.localeCompare(b.period)),
    [income.data]
  )

  const rows = useMemo(
    () => monthlyPayAndSend({ slips, transfers: transfers.data, expenses: expenses.data }),
    [slips, transfers.data, expenses.data]
  )
  const summary = useMemo(() => sendingSummary(rows), [rows])
  // Deductions that changed rate and stayed changed — 住民税 starting in June,
  // 社会保険 re-graded in September. Both are easy to miss on a slip you skim.
  const steps = useMemo(() => detectDeductionSteps(slips), [slips])

  const pick = () => fileRef.current?.click()

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const kind = payslipFileKind(file)
    if (kind === 'unsupported') {
      toast('Upload a PDF or a photo of the payslip')
      return
    }

    setBusy(true)
    try {
      // 1 — on this device. Nothing leaves, nothing costs, nothing is guessed.
      if (kind === 'pdf' || kind === 'pdf-too-big') {
        const local = await readPayslipPdf(file)
        if (local.ok || (local.payments?.length && local.period)) {
          setDraft({ slip: stripMeta(local), problems: local.problems || [], source: 'local' })
          setBusy(false)
          return
        }
        // 2 — the model, only if the parser could not read it, it is switched
        //     on, and the file is small enough to inline (a 12MB scan is not).
        if (kind === 'pdf' && aiEnabled('payslips') && isAvailable('payslips')) {
          const dataUrl = await readAsDataUrl(file)
          const result = await extractPayslip(dataUrl)
          setDraft({ slip: fromAiShape(result.payslip), problems: result.problems, source: 'ai' })
          setBusy(false)
          return
        }
        // 3 — by hand, pre-filled with whatever was readable.
        toast(local.scanned ? 'That PDF is a scan — type the figures in' : 'Could not read that layout — type the figures in')
        setDraft({ slip: blankSlip(), problems: [], source: 'manual' })
        setBusy(false)
        return
      }

      // A photograph can only go to the model, or be typed.
      if (aiEnabled('payslips') && isAvailable('payslips')) {
        const dataUrl = await compressImage(file)
        const result = await extractPayslip(dataUrl)
        setDraft({ slip: fromAiShape(result.payslip), problems: result.problems, source: 'ai' })
      } else {
        toast('A photo needs the AI reader — turn it on in Settings, or type the figures in')
        setDraft({ slip: blankSlip(), problems: [], source: 'manual' })
      }
    } catch (error) {
      toast(`Could not read that — ${String(error.message || error).replace(/^ai: /, '')}`)
      setDraft({ slip: blankSlip(), problems: [], source: 'manual' })
    } finally {
      setBusy(false)
    }
  }

  const editDraft = (mutate) =>
    setDraft((d) => {
      const slip = mutate(structuredClone(d.slip))
      return { ...d, slip, problems: checkParsedPayslip(slip).problems }
    })

  const save = async () => {
    // A row with no label or no figure was a row someone started and left; it
    // is noise in the database and noise in every trend built on it.
    const clean = (lines = []) =>
      lines
        .filter((l) => l.ja?.trim() && Number.isFinite(l.amount))
        .map((l) => ({ ja: l.ja.trim(), en: l.en || '', amount: l.amount }))
    // Attendance is kept because a zero there is real ("no days absent") —
    // but only if the employer fills that section in at all. A slip printing
    // twenty untouched zeros is an unused part of the form, not twenty facts.
    const attendance = clean(draft.slip.attendance)
    const slip = {
      ...draft.slip,
      payments: clean(draft.slip.payments),
      deductions: clean(draft.slip.deductions),
      attendance: attendance.some((a) => a.amount !== 0) ? attendance : [],
    }
    const net = netOf(slip)
    if (!slip.period) {
      toast('Set the pay month first')
      return
    }
    if (!Number.isFinite(net)) {
      toast('Set the net pay — that is the figure your balances follow')
      return
    }
    setSaving(true)
    try {
      const [year, month] = slip.period.split('-').map(Number)
      const existing = income.data.find((r) => r.payslip?.period === slip.period)
      const record = {
        // The amount that actually reached the account, NOT gross — an in-kind
        // benefit added and deducted back would otherwise inflate every balance.
        amount: net,
        source: 'Salary',
        gross: grossOf(slip),
        net,
        country: 'JP',
        payslip: slip,
        date: new Date(year, month - 1, 25),
        note: `Payslip ${slip.period}`,
      }
      // One slip per month: re-uploading corrects it rather than stacking a
      // second salary on top of the first.
      if (existing) await income.update(existing.id, record)
      else await income.add(record)
      toast(`✓ ${periodLabel(slip.period)} saved · ${yen(net)}`)
      setDraft(null)
    } catch {
      toast('⚠️ Could not save that payslip')
    } finally {
      setSaving(false)
    }
  }

  const slipUndo = useUndoableDelete(income.remove, 'Payslip')

  if (income.loading) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-5 pb-16 lg:pb-0">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">Payslips</h1>
        <p className="text-xs text-gray-400">
          Read on this device, in Japanese and English. The file is never stored.
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={handleFile}
        className="hidden"
      />
      <div className="card space-y-3 p-4">
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {busy ? 'Reading…' : 'Upload a payslip'}
        </button>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          A payroll PDF is read here on your phone — nothing is uploaded, and every line comes
          back with its English meaning. A scan or photo falls back to the AI reader if you have
          it switched on, and to typing it in if not.
        </p>
        <button
          type="button"
          onClick={() => setDraft({ slip: blankSlip(), problems: [], source: 'manual' })}
          className="min-h-11 w-full text-xs font-medium text-gray-500 underline-offset-4 hover:underline dark:text-gray-400"
        >
          No PDF? Type one in by hand
        </button>
      </div>

      {/* ---- Earned → sent home → kept ------------------------------------ */}
      {rows.length > 0 && <SendingPanel rows={rows} summary={summary} onOpen={setOpenMonth} />}

      {/* ---- Rate changes -------------------------------------------------- */}
      {steps.length > 0 && <StepsPanel steps={steps} />}

      {/* ---- The slips ----------------------------------------------------- */}
      {slips.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No payslips yet"
          hint="Upload the PDF your payroll portal gives you — it reads in a second, without leaving your phone."
        />
      ) : (
        <div className="card divide-y divide-gray-200 dark:divide-white/5">
          {[...slips].reverse().map((slip) => {
            if (slipUndo.pendingIds.has(slip.id)) return null
            const net = netOf(slip)
            return (
              <div key={slip.period} className="flex items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setOpenMonth(slip.period)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {periodLabel(slip.period)}
                    </span>
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                      {slip.payments?.length || 0} payment lines · {slip.deductions?.length || 0} deductions
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
                    {yen(net)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => slipUndo.requestDelete(slip.id)}
                  aria-label={`Delete the ${periodLabel(slip.period)} payslip`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-400 transition-transform active:scale-90 hover:text-red-500 touch-manipulation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {draft && (
        <ReviewSheet
          draft={draft}
          saving={saving}
          onEdit={editDraft}
          onSave={save}
          onUpload={() => {
            setDraft(null)
            pick()
          }}
          onClose={() => setDraft(null)}
        />
      )}

      {openMonth && (
        <MonthSheet
          period={openMonth}
          slips={slips}
          row={rows.find((r) => r.period === openMonth)}
          onClose={() => setOpenMonth(null)}
        />
      )}
    </div>
  )
}

// ---- Earned → sent → kept ---------------------------------------------------

function SendingPanel({ rows, summary, onOpen }) {
  const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—')
  const total = Math.max(summary.totalNet, summary.totalSent + summary.totalSpent, 1)
  return (
    <div className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <Send size={14} aria-hidden="true" /> Where the money went
      </h2>
      <p className="-mt-1 text-[11px] text-gray-500 dark:text-gray-400">
        Across {summary.monthsPaid} month{summary.monthsPaid === 1 ? '' : 's'} of payslips
      </p>

      {/* The four figures that answer it: what came in, what went home, what
          was spent here, what survived. Sent home carries BOTH currencies —
          the yen that left and the rupees that arrived are different numbers
          and both matter. */}
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat label="Income (take-home)" value={yen(summary.totalNet)} />
        <Stat
          label="Sent home"
          value={yen(summary.totalSent)}
          sub={summary.totalReceived > 0 ? formatINR(Math.round(summary.totalReceived)) : pct(summary.sentPct)}
          subStrong={summary.totalReceived > 0}
        />
        <Stat label="Spent here" value={yen(summary.totalSpent)} sub={pct(summary.spentPct)} bad />
        <Stat
          label="Left over"
          value={yen(summary.totalLeft)}
          sub={pct(summary.leftPct)}
          good={summary.totalLeft >= 0}
          bad={summary.totalLeft < 0}
        />
      </div>

      {/* The same four numbers, to scale. */}
      <div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-700">
          <span
            className="h-full bg-indigo-500"
            style={{ width: `${(summary.totalSent / total) * 100}%` }}
          />
          <span
            className="h-full bg-rose-500"
            style={{ width: `${(summary.totalSpent / total) * 100}%` }}
          />
          <span
            className="h-full bg-emerald-500"
            style={{ width: `${(Math.max(0, summary.totalLeft) / total) * 100}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
          <span className="text-indigo-500">■ sent home</span>{' '}
          <span className="text-rose-500">■ spent here</span>{' '}
          <span className="text-emerald-500">■ left over</span>
        </p>
      </div>

      {summary.totalReceived > 0 && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Your family received{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-200">
            {formatINR(Math.round(summary.totalReceived))}
          </span>{' '}
          for the {yen(summary.totalSent)} you sent — an effective ₹
          {summary.avgRate?.toFixed(3)} per ¥1 after fees
          {summary.totalFees > 0 && <> ({yen(summary.totalFees)} of fees)</>}.
        </p>
      )}

      {/* The one lever available: when you send. */}
      {summary.best && summary.worst && summary.best.period !== summary.worst.period && (
        <p className="rounded-lg bg-gray-100/70 px-3 py-2 text-[11px] text-gray-600 dark:bg-neutral-800/50 dark:text-gray-300">
          Best rate was <b>{periodLabel(summary.best.period)}</b> at ₹{summary.best.rate.toFixed(3)},
          worst <b>{periodLabel(summary.worst.period)}</b> at ₹{summary.worst.rate.toFixed(3)}.
          {summary.rupeesLostToTiming > 0 && (
            <>
              {' '}
              Sending everything at your best rate would have been about{' '}
              <b>{formatINR(summary.rupeesLostToTiming)}</b> more.
            </>
          )}
        </p>
      )}

      <div className="space-y-1">
        {[...rows].reverse().map((r) => (
          <button
            key={r.period}
            type="button"
            onClick={() => onOpen(r.period)}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left transition-colors hover:bg-gray-100/60 dark:hover:bg-white/5"
          >
            <span className="w-20 shrink-0 text-xs font-medium text-gray-700 dark:text-gray-200">
              {periodLabel(r.period)}
            </span>
            {/* Sent / spent / left, to scale, so a heavy month is seen not read. */}
            <span className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-700">
              {Number.isFinite(r.net) && r.net > 0 && (
                <>
                  <span
                    className="h-full bg-indigo-500"
                    style={{ width: `${Math.min(100, (r.sent / r.net) * 100)}%` }}
                  />
                  <span
                    className="h-full bg-rose-500"
                    style={{ width: `${Math.min(100, (r.spent / r.net) * 100)}%` }}
                  />
                  <span className="h-full flex-1 bg-emerald-500/70" />
                </>
              )}
            </span>
            <span className="w-40 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
              {r.sent > 0 && (
                <span className="text-indigo-500 dark:text-indigo-400">{yen(r.sent)}</span>
              )}
              {r.sent > 0 && r.spent > 0 && ' · '}
              {r.spent > 0 && <span className="text-rose-500 dark:text-rose-400">{yen(r.spent)}</span>}
              {r.sent === 0 && r.spent === 0 && '—'}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500">
        Each bar is that month's take-home, split three ways. Rupee spending is not in these
        figures — it is other money.
      </p>
    </div>
  )
}

function Stat({ label, value, sub, good, bad, subStrong }) {
  const tone = good
    ? 'text-emerald-600 dark:text-emerald-400'
    : bad
      ? 'text-rose-500 dark:text-rose-400'
      : 'text-gray-900 dark:text-gray-100'
  return (
    <div className="rounded-xl bg-gray-100/80 p-2.5 dark:bg-neutral-800/50">
      <p className={`text-sm font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] text-gray-500 dark:text-gray-400">{label}</p>
      {sub && (
        // The rupee figure is not a footnote — it is the number that matters to
        // the people receiving it, so it is set as strongly as the yen above.
        <p
          className={`text-[10px] tabular-nums ${
            subStrong ? 'font-semibold text-gray-600 dark:text-gray-300' : 'text-gray-400'
          }`}
        >
          {sub}
        </p>
      )}
    </div>
  )
}

// ---- One month, in full -----------------------------------------------------

// Deductions that changed rate and kept the new one.
//
// The two that matter here are both invisible until they have already happened:
// 住民税 is not deducted at all in your first year and then starts in June at a
// rate set by last year's income, and 社会保険 is re-graded every September. Each
// quietly takes a few thousand yen a month off every future payslip, and the
// only place it shows is a line you have no reason to compare month to month.
//
// The annual figure is the point. A ¥18,500 line reads as small; ¥222,000 a
// year does not.
function StepsPanel({ steps }) {
  return (
    <section className="card space-y-2.5 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <span aria-hidden="true">📈</span>
        Deductions that changed rate
      </h2>
      <div className="space-y-2">
        {steps.map((step) => (
          <div
            key={`${step.ja}-${step.period}`}
            className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"
          >
            <p className="font-semibold">
              {step.ja}
              {step.en && ` · ${step.en}`}
              <span className="font-normal text-amber-700/80 dark:text-amber-400/70">
                {' '}
                — from {step.period}
              </span>
            </p>
            <p className="mt-0.5 tabular-nums">
              {formatJPY(step.from)} → {formatJPY(step.to)}{' '}
              <span className="font-semibold">
                ({step.change > 0 ? '+' : '−'}
                {formatJPY(Math.abs(step.change))}/month)
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-400/70">
              {step.change > 0 ? 'Costs' : 'Saves'} about{' '}
              {formatJPY(Math.abs(step.annualImpact))} across a year.
              {step.provisional && ' Seen once so far — next month will confirm it.'}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function MonthSheet({ period, slips, row, onClose }) {
  const slip = slips.find((s) => s.period === period)
  const previous = slips[slips.findIndex((s) => s.period === period) - 1]
  const changes = useMemo(
    () => (slip ? compareSlips(slip, previous).filter((c) => c.delta) : []),
    [slip, previous]
  )

  return (
    <BottomSheet onClose={onClose} title={periodLabel(period)}>
      {slip ? (
        <>
          <LineTable title="支給 · Payments" lines={slip.payments} />
          <LineTable title="控除 · Deductions" lines={slip.deductions} negative />
          <div className="grid grid-cols-2 gap-2">
            <Stat label="総支給額 · Gross" value={yen(grossOf(slip))} />
            <Stat label="差引支給額 · Net" value={yen(netOf(slip))} good />
          </div>

          {changes.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                Changed since {periodLabel(previous.period)}
              </p>
              {changes.map((c) => (
                <div key={c.ja} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">
                    {c.ja}
                    {c.en && <span className="text-gray-400"> · {c.en}</span>}
                    {c.isNew && <span className="text-emerald-500"> new</span>}
                    {c.stopped && <span className="text-gray-400"> stopped</span>}
                  </span>
                  <span
                    className={`shrink-0 tabular-nums font-semibold ${
                      c.delta > 0 ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {signed(c.delta)}
                  </span>
                </div>
              ))}
              <p className="text-[10px] text-gray-400">
                A deduction going up costs you, so it reads red.
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No payslip saved for this month yet.
        </p>
      )}

      {row && row.sent > 0 && (
        <div className="rounded-xl border border-gray-200 p-3 text-xs dark:border-neutral-700">
          <p className="font-semibold text-gray-700 dark:text-gray-200">Sent to India</p>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            {yen(row.sent)} → {formatINR(Math.round(row.received))} over {row.transferCount}{' '}
            transfer{row.transferCount === 1 ? '' : 's'}
            {row.rate && <> at ₹{row.rate.toFixed(3)} per ¥1</>}
          </p>
          {Number.isFinite(row.left) && (
            <p className="mt-1.5 border-t border-gray-200 pt-1.5 text-gray-500 dark:border-white/5 dark:text-gray-400">
              Spent here {yen(row.spent)} · left over{' '}
              <span
                className={
                  row.left >= 0
                    ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                    : 'font-semibold text-rose-500 dark:text-rose-400'
                }
              >
                {yen(row.left)}
              </span>
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  )
}

function LineTable({ title, lines = [], negative }) {
  if (lines.length === 0) return null
  const total = lines.reduce((s, l) => s + (l.amount || 0), 0)
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{title}</p>
      {lines.map((l) => (
        <div key={l.ja} className="flex items-baseline gap-2 text-xs">
          <span className="min-w-0 flex-1">
            <span className="text-gray-700 dark:text-gray-200">{l.ja}</span>
            {l.en && <span className="text-gray-400 dark:text-gray-500"> · {l.en}</span>}
          </span>
          <span
            className={`shrink-0 tabular-nums font-medium ${
              negative ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
            }`}
          >
            {negative ? '−' : ''}
            {yen(l.amount)}
          </span>
        </div>
      ))}
      <div className="flex items-baseline gap-2 border-t border-gray-200 pt-1 text-xs dark:border-white/5">
        <span className="min-w-0 flex-1 text-gray-500 dark:text-gray-400">Total</span>
        <span className="shrink-0 font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {negative ? '−' : ''}
          {yen(total)}
        </span>
      </div>
    </div>
  )
}

// ---- Review before anything is saved ---------------------------------------

function ReviewSheet({ draft, saving, onEdit, onSave, onUpload, onClose }) {
  const { slip, problems, source } = draft
  const title = source === 'manual' ? 'Enter your payslip' : 'Check the figures'
  const note = {
    local: '✓ Read from your PDF on this device — nothing was uploaded anywhere.',
    ai: 'Read by Gemini. Check every figure against your slip before saving.',
    manual: 'Copy the figures across from your slip. Japanese label on the left, amount on the right — the English underneath appears as you type.',
  }[source]

  const setLine = (side, i, field, value) =>
    onEdit((s) => {
      // An emptied field stays empty rather than snapping back to 0, so it can
      // be cleared and retyped.
      s[side][i][field] = field === 'amount' ? (value === '' ? null : toNumber(value)) : value
      if (field === 'ja') s[side][i].en = englishFor(value)
      return s
    })

  const addLine = (side) =>
    onEdit((s) => {
      s[side].push({ ja: '', en: '', amount: null })
      return s
    })

  const removeLine = (side, i) =>
    onEdit((s) => {
      s[side].splice(i, 1)
      return s
    })

  const setTotal = (key, value) =>
    onEdit((s) => {
      s.totals = { ...s.totals, [key]: value === '' ? null : toNumber(value) }
      return s
    })

  return (
    <BottomSheet onClose={onClose} title={title}>
      <p
        className={`text-[11px] ${
          source === 'local'
            ? 'font-medium text-emerald-600 dark:text-emerald-400'
            : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        {note}
      </p>

      {problems.length > 0 && (
        <div className="space-y-1 rounded-xl bg-amber-500/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <TriangleAlert size={13} aria-hidden="true" /> The slip does not add up
          </p>
          {problems.map((p) => (
            <p key={p} className="text-[11px] text-amber-700/90 dark:text-amber-400/90">
              {p}
            </p>
          ))}
          <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70">
            You can still save it — but a figure is probably wrong.
          </p>
        </div>
      )}

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Pay month
        <input
          type="month"
          value={slip.period}
          onChange={(e) => onEdit((s) => ({ ...s, period: e.target.value }))}
          className="input"
        />
      </label>

      <EditableLines
        title="支給 · Payments"
        lines={slip.payments}
        onChange={(i, f, v) => setLine('payments', i, f, v)}
        onAdd={() => addLine('payments')}
        onRemove={(i) => removeLine('payments', i)}
      />
      <EditableLines
        title="控除 · Deductions"
        lines={slip.deductions}
        onChange={(i, f, v) => setLine('deductions', i, f, v)}
        onAdd={() => addLine('deductions')}
        onRemove={(i) => removeLine('deductions', i)}
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          総支給額 · Gross
          <input
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={slip.totals.gross ?? ''}
            onChange={(e) => setTotal('gross', e.target.value)}
            className="input tabular-nums"
          />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          差引支給額 · Net
          <input
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={slip.totals.net ?? ''}
            onChange={(e) => setTotal('net', e.target.value)}
            className="input tabular-nums"
          />
        </label>
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500">
        Net is the figure your balances follow — it is what actually reached the bank.
      </p>

      <button
        type="button"
        disabled={saving}
        onClick={onSave}
        className="btn-primary min-h-12 w-full text-sm"
      >
        {saving ? 'Saving…' : `Save ${slip.period ? periodLabel(slip.period) : 'payslip'}`}
      </button>

      {/* Typing a slip out by hand when the PDF would have read itself in a
          second is worth one line to prevent. */}
      {source === 'manual' && onUpload && (
        <button
          type="button"
          onClick={onUpload}
          className="min-h-11 w-full text-xs font-medium text-indigo-600 dark:text-indigo-400"
        >
          ↑ Upload the PDF instead — it fills this in for you
        </button>
      )}
    </BottomSheet>
  )
}

function EditableLines({ title, lines = [], onChange, onAdd, onRemove }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{title}</p>
      {lines.map((l, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="min-w-0 flex-1">
            <input
              type="text"
              value={l.ja}
              placeholder="項目"
              onChange={(e) => onChange(i, 'ja', e.target.value)}
              className="input"
            />
            {l.en && (
              <span className="mt-0.5 block truncate pl-1 text-[10px] text-gray-400">{l.en}</span>
            )}
          </span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={l.amount ?? ''}
            onChange={(e) => onChange(i, 'amount', e.target.value)}
            className="input w-24 shrink-0 tabular-nums"
          />
          <button
            type="button"
            onClick={() => onRemove(i)}
            aria-label={`Remove ${l.ja || 'line'}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-400 transition-transform active:scale-90 hover:text-red-500 touch-manipulation"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 text-xs font-medium text-gray-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-gray-400"
      >
        <Pencil size={12} aria-hidden="true" /> Add a line
      </button>
    </div>
  )
}
