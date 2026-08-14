import { useMemo, useState } from 'react'
import { useSettings } from '../../hooks/useSettings'
import { useCollection } from '../../hooks/useCollection'
import { useBatchOps } from '../../hooks/useBatchOps'
import { useToast } from '../../context/ToastContext'
import { ask, isAvailable } from '../../lib/ai'
import { formatByCountry } from '../../lib/format'
import { CATEGORY_ICONS } from '../../lib/constants'
import {
  applyAnswer,
  buildPrompt,
  checkOps,
  toOps,
  validateDraft,
  vocabulary,
} from '../../lib/storyIntake'
import BottomSheet from '../ui/BottomSheet'

// Tell it what happened, in your own words.
//
// Nothing here writes anything on its own. The model proposes, storyIntake.js
// checks every field against the app's own rules, anything missing becomes a
// question, and only a person pressing Save puts a row in the database. A
// model that quietly invented an amount or a payment method would be the worst
// failure this app could have, so it is never given the chance.
export default function StorySheet({ onClose }) {
  const { settings } = useSettings()
  const trips = useCollection('trips')
  const batchOps = useBatchOps()
  const { toast } = useToast()

  const [story, setStory] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const accounts = settings?.accounts || []
  const vocab = useMemo(
    () => ({ ...vocabulary({ accounts, trips: trips.data }), accountList: accounts }),
    [accounts, trips.data]
  )

  const read = async () => {
    if (story.trim().length < 8) {
      setError('Tell it a little more than that.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const reply = await ask(buildPrompt(story, vocab), { json: true, feature: 'entry' })
      setDraft(validateDraft(reply, vocab))
    } catch {
      setError('Could not read that. Check the connection, or type it in the normal form.')
    } finally {
      setBusy(false)
    }
  }

  const answer = (recordIndex, field, value) => {
    setDraft((d) => {
      const records = d.records.map((r, i) =>
        i === recordIndex ? applyAnswer(r, field, value, vocab) : r
      )
      // Re-checked from scratch, so answering one thing can reveal or clear
      // another — picking a card settles the currency question with it.
      return validateDraft({ records: records.map(toRaw), questions: [] }, vocab)
    })
  }

  const save = async () => {
    const contradictions = checkOps(draft.records)
    if (contradictions.length > 0) {
      setError('Something did not add up — open the normal form for this one.')
      return
    }
    setBusy(true)
    try {
      await batchOps(toOps(draft.records))
      toast(`✓ ${draft.records.length} record${draft.records.length === 1 ? '' : 's'} saved`)
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setBusy(false)
    }
  }

  if (!isAvailable('entry')) {
    return (
      <BottomSheet onClose={onClose} title="Tell it what happened">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Turn on <strong>Conversational entry</strong> in Settings → Assistant first. It sends what
          you type, plus the names of your accounts and categories, to Google's model — nothing
          else, and no figures you have already logged.
        </p>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet onClose={onClose} title="Tell it what happened">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!draft && (
        <>
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            rows={5}
            autoFocus
            placeholder="Flying to India on 11 Sep, back 4 Oct, Cathay Pacific — paid ¥131,080 including ¥4,700 extra baggage. Took 8 paid days, 3 summer leave and 1 unpaid."
            className="input resize-none"
          />
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Say it however you like. Anything it isn't sure of, it asks — nothing is saved until you
            press Save.
          </p>
          <button type="button" onClick={read} disabled={busy} className="btn-primary w-full py-3 text-sm">
            {busy ? 'Reading…' : 'Read this'}
          </button>
        </>
      )}

      {draft && (
        <>
          {/* Questions first: these are the things it refused to guess. */}
          {draft.questions.length > 0 && (
            <div className="space-y-3">
              {draft.questions.map((q) => (
                <div key={`${q.recordIndex}-${q.field}`} className="rounded-xl bg-indigo-500/10 p-3">
                  <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">{q.ask}</p>
                  <Answer
                    field={q.field}
                    vocab={vocab}
                    onAnswer={(v) => answer(q.recordIndex, q.field, v)}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {draft.records.map((r, i) => (
              <DraftRow key={i} record={r} />
            ))}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(null)
                setError('')
              }}
              className="min-h-11 flex-1 rounded-xl border border-gray-300/60 text-sm font-semibold text-gray-700 dark:border-white/10 dark:text-gray-200"
            >
              Start again
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !draft.ready}
              className="btn-primary min-h-11 flex-1 text-sm disabled:opacity-50"
            >
              {draft.ready ? `Save ${draft.records.length}` : 'Answer the questions'}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}

// One proposed record, in plain words, so it can be checked before it is saved.
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

// Answering is a tap where the answer is one of a known set, and typing only
// where it genuinely is not — a payment method typed by hand is how a wrong one
// gets in.
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
        type={field === 'amount' ? 'number' : 'text'}
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
// goes back through it in that shape rather than a second, divergent path.
const toRaw = (r) => ({
  ...r,
  startDate: r.startDate instanceof Date ? iso(r.startDate) : r.startDate,
  endDate: r.endDate instanceof Date ? iso(r.endDate) : r.endDate,
  date: r.date instanceof Date ? iso(r.date) : r.date,
})

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
