import { lazy, Suspense } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useTheme } from '../../context/ThemeContext'
import HudLayer from './HudLayer'

// The boot sequence is its own chunk: it runs for one second and then never
// again this session, so it has no business being downloaded alongside the
// screen you actually came here to read.
const PowerOn = lazy(() => import('./PowerOn'))

// Everything app-shell-level the HUD adds, in one mount point. Renders nothing
// at all for flat skins, and HudMount itself is lazy-loaded by Layout — so
// Framer Motion stays out of the main bundle entirely and a Classic user never
// downloads a byte of the suit.
export default function HudMount() {
  const { hud, booting, endBoot } = useTheme()
  if (!hud) return null

  return (
    <>
      <HudLayer />
      <AnimatePresence>
        {booting && (
          <Suspense fallback={null}>
            <PowerOn onDone={endBoot} />
          </Suspense>
        )}
      </AnimatePresence>
    </>
  )
}
