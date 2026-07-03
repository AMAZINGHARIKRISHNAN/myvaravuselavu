import { useState } from 'react'
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
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">✨</span>
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
              className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-base transition-transform active:scale-90 ${
                listening ? 'animate-pulse' : ''
              }`}
            >
              {listening ? '🔴' : '🎤'}
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
