import { useState } from 'react'
import { CATEGORIES, CATEGORY_ICONS } from '../../lib/constants'

// The answer to one question the app refused to guess.
//
// A tap where the answer is one of a known set, typing only where it genuinely
// is not — a payment method typed by hand is how a wrong one gets in.
//
// Shared by every path that asks: a story the model drafted, and a one-line
// entry typed as shorthand. Two copies of this would drift, and the drift would
// be in which answers are offered for money fields.
//
// `options` is an ORDER, not a filter: every answer is always offered, the
// likeliest simply comes first. A caller with no opinion passes nothing and
// gets the app's own order, which is what the story path does.
export default function AnswerChips({ field, vocab, options, onAnswer }) {
  const [typed, setTyped] = useState('')

  if (field === 'paymentMethod' || field === 'account') {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(options || vocab.paymentMethods).map((m) => (
          <Chip key={m} onClick={() => onAnswer(m)}>
            {m}
          </Chip>
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
          <Chip key={value} onClick={() => onAnswer(value)}>
            {label}
          </Chip>
        ))}
      </div>
    )
  }

  if (field === 'category') {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(options || CATEGORIES).map((c) => (
          <Chip key={c} onClick={() => onAnswer(c)}>
            {CATEGORY_ICONS[c] || '📌'} {c}
          </Chip>
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

function Chip({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-gray-700 active:scale-95 dark:text-gray-200"
    >
      {children}
    </button>
  )
}
