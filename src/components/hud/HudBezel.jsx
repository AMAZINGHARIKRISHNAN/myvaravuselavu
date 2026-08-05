// Deliberately dependency-free. GradientDonut renders this on the Charts page,
// which flat skins load too — importing framer-motion here would put a link to
// the animation library on a code path Classic and Neon take. Same plain
// matchMedia read the rest of the app uses (useAnimatedNumber, celebrate).
const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

// The machined ring. Extracted from ArcReactor so the balance reactor and every
// chart gauge wear the *same* bezel rather than two things that merely resemble
// each other — that similarity is the whole reason the screens read as one
// instrument panel instead of a pile of widgets.
//
// Draws into a 120×120 viewBox and fills its parent, so a caller only has to
// give it a square box. Radii are in viewBox units: 60 is the edge.
export default function HudBezel({ color, outer = 57, inner = 36, spin = true }) {
  const quiet = reducedMotion()
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {/* 3-on/5-off reads as a machined bezel; a solid ring would just read as
          a second border. */}
      <circle
        cx="60"
        cy="60"
        r={outer}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray="3 5"
        opacity="0.4"
        style={
          spin && !quiet
            ? { transformOrigin: 'center', animation: 'hud-spin 24s linear infinite' }
            : undefined
        }
      />
      <circle cx="60" cy="60" r={inner} fill="none" stroke={color} strokeWidth="0.75" opacity="0.2" />
    </svg>
  )
}
