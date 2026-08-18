import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'
import { hudGreeting, hudName } from '../../lib/hud'
import { roleLine } from '../../lib/persona'
import { headlineFor } from '../../lib/narrate'

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

// The suit talking to you.
//
// The line is not written here — lib/hud.js asks askJarvis() for it, which is
// the same router the mic button uses. That's deliberate: the greeting quotes a
// real safe-to-spend figure, and it is the assistant's figure, not a second
// calculation that could drift from it.
export default function HudGreeting({ name, salaryInDays, signals = [], ...ctx }) {
  const { skin } = useTheme()
  const { salute, status: fallbackStatus, to } = hudGreeting({ skin, name, ...ctx })
  // A real signal beats a static line. headlineFor picks the most significant
  // narratable one — a projected shortfall outranks a budget date — and falls
  // back to the router's own answer when nothing has anything to say.
  const status = headlineFor(signals, skin) ?? fallbackStatus
  const [typed, setTyped] = useState(() => (reducedMotion() ? status : ''))

  useEffect(() => {
    if (reducedMotion()) {
      setTyped(status)
      return
    }
    setTyped('')
    let i = 0
    // ~22ms/char: fast enough to finish before you've read the greeting above
    // it, slow enough to read as typing rather than as a flicker.
    const id = setInterval(() => {
      i += 1
      setTyped(status.slice(0, i))
      if (i >= status.length) clearInterval(id)
    }, 22)
    return () => clearInterval(id)
  }, [status])

  const line = (
    // aria-live is off and the full text is in aria-label: a screen reader
    // should hear the sentence once, not sixty times as it types.
    <p
      className="mt-1 font-mono text-xs text-indigo-300"
      aria-label={status}
    >
      <span aria-hidden="true">
        {typed}
        {typed.length < status.length && <span className="opacity-60">▌</span>}
      </span>
    </p>
  )

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.3em] text-indigo-400/70">
          {hudName(skin)}
        </p>
        {/* What this suit is for. Three AIs with three jobs should say so. */}
        <p className="text-[9px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-500">
          {roleLine(skin)}
        </p>
        <h2 className="mt-0.5 text-xl font-bold tracking-tight text-white">{salute}</h2>
        {to ? (
          <Link to={to} className="block">
            {line}
          </Link>
        ) : (
          line
        )}
      </div>
      {salaryInDays !== null && salaryInDays !== undefined && (
        <span className="flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-indigo-300">
          {salaryInDays === 0 ? 'PAYDAY' : `T−${salaryInDays}d`}
        </span>
      )}
    </div>
  )
}
