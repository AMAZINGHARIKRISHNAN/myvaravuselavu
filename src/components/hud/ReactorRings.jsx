import { useMemo } from 'react'

// The arc reactor, drawn properly.
//
// Reference language, taken apart into layers that can each animate on their
// own axis — which is what makes it read as an instrument rather than a spinner:
//
//   · tick ring      72 radial ticks, every sixth one long. The thing that
//                    makes it look machined rather than drawn.
//   · segment ring   four thick arcs with gaps, rotating slowly
//   · dash ring      a fine dashed ring counter-rotating
//   · sweep arc      one bright arc in the identity's SECOND colour (gold on
//                    JARVIS), travelling round like a radar sweep
//   · indicators     five dots on the upper arc, lit in sequence
//   · core           the triangular emblem, the bit everyone recognises
//
// Everything animates by `transform: rotate` on a group, so the whole thing is
// GPU-composited — no path re-drawing, no layout, no repaint. Ticks are computed
// once and memoised; the SVG is static after mount.
export default function ReactorRings({
  core = '#3fd0ff',
  core2 = '#57e2ff',
  alt = '#ffb547',
  size = 260,
  spin = true,
  emblem = true,
  className = '',
}) {
  // 72 ticks = one every 5°. Every sixth (30°) is long, the way a dial is
  // marked. Generated rather than hand-authored so the spacing cannot drift.
  const ticks = useMemo(
    () =>
      Array.from({ length: 72 }, (_, i) => {
        const major = i % 6 === 0
        return { angle: i * 5, length: major ? 9 : 4.5, width: major ? 1.6 : 0.9, major }
      }),
    []
  )

  const R = 100 // viewBox is 0 0 200 200, so the centre is (100,100)

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="rr-sweep" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={alt} stopOpacity="0" />
          <stop offset="60%" stopColor={alt} stopOpacity="0.9" />
          <stop offset="100%" stopColor={core2} stopOpacity="1" />
        </linearGradient>
        <radialGradient id="rr-core">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="45%" stopColor={core2} stopOpacity="0.85" />
          <stop offset="100%" stopColor={core} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ---- tick ring: the machined dial ---- */}
      <g opacity="0.75">
        {ticks.map((t) => (
          <line
            key={t.angle}
            x1={R}
            y1={R - 88}
            x2={R}
            y2={R - 88 + t.length}
            stroke={t.major ? core2 : core}
            strokeWidth={t.width}
            opacity={t.major ? 0.95 : 0.5}
            transform={`rotate(${t.angle} ${R} ${R})`}
          />
        ))}
      </g>

      {/* ---- segment ring: four thick arcs with gaps, slow clockwise ---- */}
      <g
        style={
          spin
            ? { transformOrigin: 'center', animation: 'hud-spin 28s linear infinite' }
            : undefined
        }
      >
        <circle
          cx={R}
          cy={R}
          r="74"
          fill="none"
          stroke={core}
          strokeWidth="9"
          opacity="0.28"
          // 4 arcs, 4 gaps: circumference 2πr ≈ 465, so 86 on / 30 off.
          strokeDasharray="86 30"
          strokeLinecap="butt"
        />
      </g>

      {/* ---- dash ring: fine, counter-rotating ---- */}
      <g
        style={
          spin
            ? { transformOrigin: 'center', animation: 'hud-spin-reverse 19s linear infinite' }
            : undefined
        }
      >
        <circle
          cx={R}
          cy={R}
          r="62"
          fill="none"
          stroke={core}
          strokeWidth="1"
          strokeDasharray="2 7"
          opacity="0.5"
        />
      </g>

      {/* ---- sweep arc: the radar pass, in the identity's second colour ---- */}
      <g
        style={
          spin
            ? { transformOrigin: 'center', animation: 'hud-spin 4.2s linear infinite' }
            : undefined
        }
      >
        <circle
          cx={R}
          cy={R}
          r="74"
          fill="none"
          stroke="url(#rr-sweep)"
          strokeWidth="9"
          strokeLinecap="round"
          // One 90° arc lit out of the full ring.
          strokeDasharray="116 349"
          style={{ filter: `drop-shadow(0 0 6px ${alt}cc)` }}
        />
      </g>

      {/* ---- indicator dots: five on the upper arc, lit in sequence ---- */}
      <g>
        {[-32, -16, 0, 16, 32].map((deg, i) => (
          <circle
            key={deg}
            cx={R}
            cy={R - 52}
            r="2.4"
            fill={alt}
            transform={`rotate(${deg} ${R} ${R})`}
            style={
              spin
                ? {
                    animation: `hud-blink 2.4s ease-in-out ${i * 0.18}s infinite`,
                  }
                : { opacity: 0.85 }
            }
          />
        ))}
      </g>

      {/* ---- inner rings ---- */}
      <circle cx={R} cy={R} r="44" fill="none" stroke={core} strokeWidth="0.8" opacity="0.35" />
      <circle cx={R} cy={R} r="34" fill="none" stroke={core} strokeWidth="2" opacity="0.2" />

      {/* ---- core: the triangular emblem ---- */}
      {emblem && (
        <g
          style={
            spin
              ? { transformOrigin: 'center', animation: 'hud-pulse 3.4s ease-in-out infinite' }
              : undefined
          }
        >
          <circle cx={R} cy={R} r="30" fill="url(#rr-core)" />
          {/* Inverted triangle inside a circle — the reactor face. */}
          <path
            d={`M ${R} ${R + 17} L ${R - 15} ${R - 9} L ${R + 15} ${R - 9} Z`}
            fill="none"
            stroke={core2}
            strokeWidth="2.4"
            strokeLinejoin="round"
            style={{ filter: `drop-shadow(0 0 5px ${core}dd)` }}
          />
          <circle cx={R} cy={R} r="5" fill="#fff" opacity="0.9" />
        </g>
      )}
    </svg>
  )
}
