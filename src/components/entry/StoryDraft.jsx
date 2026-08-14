import { useState } from 'react'
import { useSettings } from '../../hooks/useSettings'
import { useCollection } from '../../hooks/useCollection'
import { useBatchOps } from '../../hooks/useBatchOps'
import { useToast } from '../../context/ToastContext'
import { formatByCountry } from '../../lib/format'
import { CATEGORY_ICONS } from '../../lib/constants'
import { applyAnswer, checkOps, toOps, validateDraft } from '../../lib/storyIntake'

// A proposed set of records, its unanswered questions, and a Save button.
//
// Lives apart from whatever produced it so the assistant can show one without
// opening a second sheet on top of itself. The rule it enforces is the same
// wherever it appears: the model proposed this, a person confirms it, and
// nothing is written before they do.
export default function StoryDraft({ draft, setDraft, vocab, onDone }) {
  const batchOps = useBatchOps()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const answer = (recordIndex, field, value) => {
    setDraft((d) => {
      const records = d.records.map((r, i) =>
        i === recordIndex ? applyAnswer(r, field, value, vocab) : r
      )
      // Re-checked from scratch, so answering one thing can clear another —
      // picking a card settles the currency question along with it.
      return validateDraft({ records: records.map(toRaw), questions: [] }, vocab)
    })
  }

  const save = async () => {
    if (checkOps(draft.records).length > 0) {
      setError('Something did not add up — use the normal form for this one.')
      return
    }
    setBusy(true)
    try {
      await batchOps(toOps(draft.records))
      toast(`✓ ${draft.records.length} record${draft.records.length === 1 ? '' : 's'} saved`)
      onDone?.()
    } catch {
      setError('Could not save. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Questions first: these are the things it refused to guess. */}
      {draft.questions.map((q) => (
        <div key={`${q.recordIndex}-${q.field}`} className="rounded-xl bg-indigo-500/10 p-3">
          <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">{q.ask}</p>
          <Answer field={q.field} vocab={vocab} onAnswer={(v) => answer(q.recordIndex, q.field, v)} />
        </div>
      ))}

      <div className="space-y-2">
        {draft.records.map((r, i) => (
          <DraftRow key={i} record={r} />
        ))}
      </div>

      <button
        type="button"
        onClick={save}
        disabled={busy || !draft.ready}
        className="btn-primary w-full py-3 text-sm disabled:opacity-50"
      >
        {draft.ready ? `Save ${draft.records.length}` : 'Answer the questions above'}
      </button>
    </div>
  )
}

// The vocabulary a draft needs, assembled where the collections live.
export function useVocabulary() {
  const { settings } = useSettings()
  const trips = useCollection('trips')
  const accounts = settings?.accounts || []
  return {
    accounts,
    trips: trips.data,
    accountList: accounts,
  }
}

function DraftRow({ record }) {
  if (record.kind === 'trip') {
    return (
      <div className="card p-3 text-xs">
        <p className="font-semibold text-gray-900 dark:text-gray-100">🧳 {record.name || '—'}</p>
        <p className="text-gray-500 dark:text-gray-400">
          {record.startDate?.toLocaleDateString()}
          {record.endDate && ` → ${record.endDate.toLocaleDateString()}`}
          {record.carrier && ` · ${record.carrier}`}
        </p>
      </div>
    )
  }
  if (record.kind === 'loss') {
    return (
      <div className="card p-3 text-xs">
        <p className="font-semibold text-gray-900 dark:text-gray-100">
          📉 {record.label} · {record.amount ? formatByCountry(record.amount, 'JP') : '—'}
        </p>
        <p className="text-gray-500 dark:text-gray-400">Money not earned — logged as a loss</p>
      </div>
    )
  }
  if (record.kind === 'income') {
    return (
      <div className="card p-3 text-xs">
        <p className="font-semibold text-gray-900 dark:text-gray-100">
          💰 {record.source} ·{' '}
          {record.amount ? formatByCountry(record.amount, record.country || 'JP') : '—'}
        </p>
        <p className="text-gray-500 dark:text-gray-400">into {record.account || '—'}</p>
      </div>
    )
  }
  return (
    <div className="card p-3 text-xs">
      <p className="font-semibold text-gray-900 dark:text-gray-100">
        {CATEGORY_ICONS[record.category] || '📌'} {record.note || record.store || record.category} ·{' '}
        {record.amount ? formatByCountry(record.amount, record.country || 'JP') : '—'}
      </p>
      <p className="text-gray-500 dark:text-gray-400">
        {record.category} · {record.paymentMethod || 'which account?'}
        {record.date && ` · ${record.date.toLocaleDateString()}`}
      </p>
    </div>
  )
}

// A tap where the answer is one of a known set, typing only where it genuinely
// is not — a payment method typed by hand is how a wrong one gets in.
function Answer({ field, vocab, onAnswer }) {
  const [typed, setTyped] = useState('')

  if (field === 'paymentMethod' || field === 'account') {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {vocab.paymentMethods.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onAnswer(m)}
            className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200"
          >
            {m}
          </button>
        ))}
      </div>
    )
  }

  if (field === 'country') {
    return (
      <div className="mt-2 flex gap-1.5">
        {[
          ['JP', '🇯🇵 Yen'],
          ['IN', '🇮🇳 Rupees'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onAnswer(value)}
            className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200"
          >
            {label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="mt-2 flex gap-1.5">
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        type={field === 'amount' ? 'number' : field === 'date' ? 'date' : 'text'}
        inputMode={field === 'amount' ? 'decimal' : undefined}
        className="input flex-1"
      />
      <button
        type="button"
        onClick={() => typed.trim() && onAnswer(typed.trim())}
        className="rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white dark:bg-indigo-500"
      >
        OK
      </button>
    </div>
  )
}

// The validator works on the raw shape a model returns, so an answered record
// goes back through it in that shape rather than by a second, divergent path.
const toRaw = (r) => ({
  ...r,
  startDate: r.startDate instanceof Date ? iso(r.startDate) : r.startDate,
  endDate: r.endDate instanceof Date ? iso(r.endDate) : r.endDate,
  date: r.date instanceof Date ? iso(r.date) : r.date,
})

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
