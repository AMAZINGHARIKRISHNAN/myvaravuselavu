import { useTheme } from '../../context/ThemeContext'
import { useDelayedShow } from '../../hooks/useDelayedShow'
import { hudMeta } from '../../lib/skins'
import ReactorRings from '../hud/ReactorRings'

// The screen you see while the app works out who you are.
//
// Two rules, both learned from it being annoying:
//
//   1. DON'T FLASH. Firebase Auth usually resolves from its local cache in
//      well under a tenth of a second. Rendering a loader immediately means a
//      spinner that appears and vanishes before it can be read — which reads as
//      a glitch, not as progress. So this renders NOTHING for the first
//      400ms, and most launches never show it at all.
//
//   2. DON'T BREAK CHARACTER. When a suit is on, the wait belongs to that suit:
//      the reactor, in the identity's own colours. A generic indigo app icon in
//      the middle of a JARVIS session is a seam.
//
// No "Loading…" caption: a turning reactor already says it.
export default function BootSplash() {
  const { skin, hud } = useTheme()
  const visible = useDelayedShow(400)

  if (!visible) return null

  const colors = hudMeta(skin)

  return (
    <div
      role="status"
      aria-label="Starting"
      className="flex min-h-svh flex-col items-center justify-center bg-gray-900 animate-[fade-in_0.25s_ease-out] dark:bg-neutral-950"
    >
      {hud && colors ? (
        <ReactorRings
          core={colors.core}
          core2={colors.core2}
          alt={colors.alt}
          size={150}
          className="max-w-[45vw]"
        />
      ) : (
        // Flat skins keep the brand mark, just without the caption.
        <img src="/logo.svg" alt="" className="h-12 w-12 animate-pulse" />
      )}
    </div>
  )
}
