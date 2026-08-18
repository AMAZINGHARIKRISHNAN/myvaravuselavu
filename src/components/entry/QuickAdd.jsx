import { useMemo, useState } from 'react'
import { Sparkles, Mic } from 'lucide-react'
import { parseExpenseText } from '../../lib/parseExpenseText'
import { answerShorthand, shorthandDraft } from '../../lib/shorthand'
import { vocabulary } from '../../lib/storyIntake'
import { mergeStoreMemory, storeMemory, storeProfiles } from '../../lib/stores'
import { formatByCountry } from '../../lib/format'
import { CATEGORY_ICONS } from '../../lib/constants'
import { useSettings } from '../../hooks/useSettings'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import AnswerChips from './AnswerChips'
import EntryFlow from './EntryFlow'

// `history` is whatever expenses the page already holds — passed in rather
// than fetched, because a quick-add box must not cost a read to open. It is
// what lets this ask about a shop once instead of every time.
export default function QuickAdd({ onSaved, history = [], friends = [] }) {
  const { settings } = useSettings()
  // Held steady across renders: `settings?.accounts || []` is a fresh array
  // every time, which would rebuild the vocabulary on every keystroke.
  const accounts = useMemo(() => settings?.accounts || [], [settings?.accounts])
  const vocab = useMemo(
    () => ({ ...vocabulary({ accounts, trips: [] }), accountList: accounts }),
    [accounts]
  )
  // Both memories as one: what has been typed on this device, and what the
  // records themselves say. Records win, since they are what was actually
  // saved; the typed list covers shops older than the loaded window.
  const known = useMemo(
    () => mergeStoreMemory(storeProfiles(history), storeMemory()),
    [history]
  )

  const [text, setText] = useState('')
  const [prefill, setPrefill] = useState(null)
  const [asking, setAsking] = useState(null)
  const [showManual, setShowManual] = useState(false)

  const submitText = (value) => {
    if (!value.trim()) return
    // Read fresh on every submit: the shop you saved a moment ago should be
    // recognised the next time you type it, not the next time this mounts.
    const parsed = parseExpenseText(value, { accounts, known })
    if (!parsed.amount) {
      setShowManual(true)
      return
    }
    setText('')

    // What the words did not settle is asked here rather than filled in
    // silently downstream. Nothing outstanding — which is most lines once a
    // shop is known — goes straight to the confirm step as before.
    const draft = shorthandDraft(parsed, vocab, { history, friends })
    if (draft.ready) setPrefill(draft.record)
    else setAsking(draft)
  }

  // One answer, then whatever it leaves. The card being chosen settles the
  // currency with it, so a two-question draft usually ends after one tap.
  const answer = (field, value) => {
    const next = answerShorthand(asking.record, field, value, vocab, { history, friends })
    if (next.ready) {
      setAsking(null)
      setPrefill(next.record)
    } else {
      setAsking(next)
    }
  }

  const { supported: voiceSupported, listening, start: startListening } = useSpeechRecognition({
    onResult: (transcript) => submitText(transcript),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    submitText(text)
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 dark:text-indigo-500">
            <Sparkles size={15} aria-hidden="true" />
          </span>
          <input
            type="text"
            placeholder={listening ? 'Listening…' : 'e.g. coffee 450'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input pl-9 pr-9"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={startListening}
              aria-label="Voice quick-add"
              className={`absolute right-1 top-1/2 flex tap-target h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full transition-all active:scale-90 touch-manipulation ${
                listening
                  ? 'animate-pulse text-red-500'
                  : 'text-gray-400 hover:text-indigo-600 dark:text-gray-500 dark:hover:text-indigo-400'
              }`}
            >
              <Mic size={16} />
            </button>
          )}
        </div>
        <button type="submit" disabled={!text.trim()} className="btn-primary px-5 text-sm">
          Add
        </button>
      </form>

      {/* What it read, and the one thing it will not assume. Sits under the
          box rather than in a sheet: it is a question about the line just
          typed, and burying it behind a modal would make answering slower
          than retyping. */}
      {asking && (
        <div className="mt-2 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">
              {CATEGORY_ICONS[asking.record.category] || '📌'}{' '}
              {formatByCountry(asking.record.amount, asking.record.country || 'JP')}
              {asking.record.store ? ` · ${asking.record.store}` : ''}
            </p>
            <button
              type="button"
              onClick={() => {
                // Straight to the form with what it has — the questions are
                // there to save typing, never to stand in the way of it.
                setPrefill(asking.record)
                setAsking(null)
              }}
              className="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400"
            >
              Skip →
            </button>
          </div>
          <p className="mt-1.5 text-xs text-indigo-700 dark:text-indigo-300">
            {asking.questions[0].ask}
          </p>
          <AnswerChips
            field={asking.questions[0].field}
            vocab={vocab}
            options={asking.questions[0].options}
            onAnswer={(v) => answer(asking.questions[0].field, v)}
          />
        </div>
      )}

      {prefill && (
        <EntryFlow
          initial={prefill}
          onClose={() => setPrefill(null)}
          onSaved={() => {
            setPrefill(null)
            onSaved?.()
          }}
        />
      )}
      {showManual && !prefill && (
        <EntryFlow
          onClose={() => setShowManual(false)}
          onSaved={() => {
            setShowManual(false)
            onSaved?.()
          }}
        />
      )}
    </>
  )
}
