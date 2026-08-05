import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useTheme } from '../../context/ThemeContext'
import { hudMeta } from '../../lib/skins'
import { bootScript, hudName, BOOT_MS } from '../../lib/hud'
import { roleLine } from '../../lib/persona'
import { playSound } from '../../lib/sound'
import ReactorRings from './ReactorRings'

// Putting the suit on.
//
// Built from the blueprint language: a machined reactor dial at the centre, a
// faint schematic grid behind it, technical readouts pinned to the corners, and
// reticle brackets framing the whole screen.
//
// ~1.1s, and skippable by tapping anywhere — a boot animation you cannot get
// out of is one you come to hate by the fourth time. Reduced motion collapses
// the lot to a single fade with the final line already resolved.

// Corner readouts. Deliberately about THIS app rather than a spaceship: the
// chrome should look technical, not cosplay as something the app isn't.
const READOUTS = [
  { at: 'top-4 left-4', label: 'SYS', value: 'NOMINAL' },
  { at: 'top-4 right-4', label: 'LINK', value: 'LOCAL' },
  { at: 'bottom-4 left-4', label: 'LEDGER', value: 'SYNCED' },
  { at: 'bottom-4 right-4', label: 'PWR', value: '100%' },
]

export default function PowerOn({ onDone }) {
  const { skin } = useTheme()
  const quiet = useReducedMotion()
  const colors = hudMeta(skin) || { core: '#3fd0ff', core2: '#57e2ff', alt: '#ffb547' }
  const lines = bootScript(skin)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (quiet) return
    const per = BOOT_MS / lines.length
    const timers = lines.map((_, i) => setTimeout(() => setStep(i), per * i))
    return () => timers.forEach(clearTimeout)
  }, [lines, quiet])

  useEffect(() => {
    playSound('confirm', skin)
    const t = setTimeout(onDone, quiet ? 220 : BOOT_MS + 320)
    return () => clearTimeout(t)
  }, [onDone, quiet, skin])

  const ease = [0.16, 1, 0.3, 1]

  return (
    <motion.div
      role="status"
      aria-label={`${hudName(skin)} online`}
      onClick={onDone}
      onKeyDown={onDone}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: quiet ? 0.15 : 0.2 }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden"
      style={{ background: `radial-gradient(circle at 50% 45%, ${colors.bg}f2, #000 75%)` }}
    >
      {/* Schematic grid, like the blueprint behind the suit drawings. */}
      <div className="hud-boot-grid" />

      {/* Reticle frame — the same corner language the panels use. */}
      <motion.div
        className="hud-boot-frame"
        style={{ '--frame': colors.core }}
        initial={{ opacity: 0, scale: quiet ? 1 : 1.04 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: quiet ? 0.15 : 0.55, ease }}
      />

      {/* Corner readouts. */}
      {READOUTS.map((r, i) => (
        <motion.div
          key={r.label}
          className={`pointer-events-none absolute ${r.at} font-mono text-[9px] uppercase tracking-[0.2em]`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: quiet ? 0.1 : 0.3, delay: quiet ? 0 : 0.25 + i * 0.06 }}
        >
          <span style={{ color: `${colors.core}80` }}>{r.label}</span>{' '}
          <span style={{ color: colors.core2 }}>{r.value}</span>
        </motion.div>
      ))}

      {/* The reactor. */}
      <motion.div
        initial={{ opacity: 0, scale: quiet ? 1 : 0.72, rotate: quiet ? 0 : -25 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ duration: quiet ? 0.15 : 0.85, ease }}
        className="relative"
      >
        <ReactorRings
          core={colors.core}
          core2={colors.core2}
          alt={colors.alt}
          size={260}
          spin={!quiet}
          className="max-w-[70vw]"
        />
      </motion.div>

      {/* Status line, typed one beat at a time. */}
      <div className="mt-8 px-8 text-center">
        <p className="font-mono text-[13px] tracking-wide" style={{ color: colors.core2 }}>
          {quiet ? lines[lines.length - 1] : lines[step]}
          {!quiet && (
            <span className="animate-[fade-in_0.5s_ease-in-out_infinite_alternate]">▌</span>
          )}
        </p>
        <p
          className="mt-3 font-mono text-[10px] uppercase tracking-[0.35em]"
          style={{ color: `${colors.core}99` }}
        >
          {hudName(skin)}
        </p>
        <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.25em] text-white/25">
          {roleLine(skin)}
        </p>
      </div>

      <p className="absolute bottom-10 font-mono text-[9px] uppercase tracking-[0.2em] text-white/25">
        tap to skip
      </p>
    </motion.div>
  )
}
