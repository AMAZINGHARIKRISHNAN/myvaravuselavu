import { motion, useReducedMotion } from 'framer-motion'
import { hudMeta } from '../../lib/skins'
import HudBezel from './HudBezel'

// The reactor the balance sits inside.
//
// Four concentric layers, all SVG so it stays crisp at any size and costs one
// element tree rather than an image:
//   · track      the unfilled remainder, barely there
//   · arc        the actual datum, drawn on mount by animating dash offset
//   · ticks      a slowly rotating segmented ring — the "it's alive" layer
//   · core       a soft radial bloom behind the number
//
// Rotation and dash offset are both GPU-composited; nothing here animates a
// box-shadow or a filter, which is what keeps it at 60fps on a phone.
export default function ArcReactor({ skin, pct = 0, size = 190, children }) {
  const quiet = useReducedMotion()
  const c = hudMeta(skin) || { core: '#3fd0ff', core2: '#57e2ff', alt: '#ffb547' }

  const r = 46
  const circumference = 2 * Math.PI * r
  // Clamped, because a savings rate can legitimately exceed 100% or go negative
  // and neither should make the ring wrap around itself.
  const filled = Math.max(0, Math.min(1, pct))

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id={`arc-${skin}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={c.core} />
            <stop offset="100%" stopColor={c.alt} />
          </linearGradient>
        </defs>

        <circle cx="60" cy="60" r={r} fill="none" stroke={c.core} strokeWidth="7" opacity="0.13" />

        {/* Machined tick dial, same language as the boot reactor — 36 ticks,
            every third long. Static: it is scale, not decoration, so it must
            not move while you are reading the number inside it. */}
        <g opacity="0.55">
          {Array.from({ length: 36 }, (_, i) => {
            const major = i % 3 === 0
            return (
              <line
                key={i}
                x1="60"
                y1={60 - 57}
                x2="60"
                y2={60 - 57 + (major ? 5 : 2.5)}
                stroke={major ? c.core2 : c.core}
                strokeWidth={major ? 1.1 : 0.7}
                opacity={major ? 0.9 : 0.45}
                transform={`rotate(${i * 10} 60 60)`}
              />
            )
          })}
        </g>

        <motion.circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={`url(#arc-${skin})`}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: quiet ? circumference * (1 - filled) : circumference }}
          animate={{ strokeDashoffset: circumference * (1 - filled) }}
          transition={{ duration: quiet ? 0 : 1.1, ease: [0.16, 1, 0.3, 1] }}
          style={{ filter: `drop-shadow(0 0 5px ${c.core}aa)` }}
        />

      </svg>

      {/* The bezel is shared with every chart gauge — see HudBezel. */}
      <HudBezel color={c.core} outer={55} inner={36} />

      {/* The bloom behind the number — pulses by transform+opacity only. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
        style={{
          background: c.core,
          opacity: 0.3,
          animation: quiet ? undefined : 'hud-pulse 3.6s ease-in-out infinite',
        }}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        {children}
      </div>
    </div>
  )
}
