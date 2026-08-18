import { useEffect, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { narrateAll } from '../../lib/narrate'
import { narrateWithAi } from '../../lib/narrateAi'

// What the forecast figures mean, in the voice of the active suit.
//
// The local templates render IMMEDIATELY — they need no key and no network, so
// there is never a spinner where a sentence should be. If the model is on and
// reachable it then replaces the wording, and only the wording: every number is
// checked to be identical before a polished line is shown (see narrateAi.js).
//
// Read-only. Nothing here writes, and the same figures sit in the raw panel
// below for anyone who wants to check the sentences against them.
export default function NarratedSignals({ signals = [], scope = {} }) {
  const { skin } = useTheme()
  const [lines, setLines] = useState(() => narrateAll(signals, skin))
  const [source, setSource] = useState('local')

  useEffect(() => {
    let cancelled = false
    // Start from the local wording so something is on screen at once.
    setLines(narrateAll(signals, skin))
    narrateWithAi(signals, skin, scope).then((out) => {
      if (cancelled) return
      setLines(out.lines)
      setSource(out.source)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, skin])

  if (lines.length === 0) return null

  return (
    <section className="card space-y-2 p-4">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        📡 What the numbers suggest
      </h2>
      <ul className="space-y-1.5">
        {lines.map((line) => (
          <li key={line.kind} className="text-sm text-gray-700 dark:text-gray-200">
            {line.text}
          </li>
        ))}
      </ul>
      {/* Said plainly: estimates from your own figures, not advice. */}
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Estimates from your own records, projected at the current pace — not advice.
        {source === 'ai' ? ' Wording by the model; every figure computed on this device.' : ''}
      </p>
    </section>
  )
}
