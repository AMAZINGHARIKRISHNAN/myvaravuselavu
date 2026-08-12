import { useState } from 'react'
import { Sparkles, Mic } from 'lucide-react'
import { parseExpenseText } from '../../lib/parseExpenseText'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import EntryFlow from './EntryFlow'

export default function QuickAdd({ onSaved }) {
  const [text, setText] = useState('')
  const [prefill, setPrefill] = useState(null)
  const [showManual, setShowManual] = useState(false)

  const submitText = (value) => {
    if (!value.trim()) return
    const parsed = parseExpenseText(value)
    if (!parsed.amount) {
      setShowManual(true)
      return
    }
    setPrefill(parsed)
    setText('')
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

      {prefill && (
        <EntryFlow initial={prefill} onClose={() => setPrefill(null)} onSaved={onSaved} />
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
