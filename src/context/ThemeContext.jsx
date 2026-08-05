import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { DEFAULT_SKIN, isSkin, isHud, skinMeta } from '../lib/skins'
import { playSound } from '../lib/sound'

const ThemeContext = createContext(null)

const BOOTED_KEY = 'vs_hud_booted'

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

// The suit boots when you put it on, and once when you launch the app — not on
// every route change (this provider sits above the router) and not on every
// refresh within a session, which in an installed PWA would be constant.
function shouldBootOnLoad(skin) {
  if (!isHud(skin) || reducedMotion()) return false
  try {
    if (sessionStorage.getItem(BOOTED_KEY) === '1') return false
    sessionStorage.setItem(BOOTED_KEY, '1')
    return true
  } catch {
    return false // private mode: skip rather than replay it forever
  }
}

function getInitialTheme() {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getInitialSkin() {
  const stored = localStorage.getItem('skin')
  return isSkin(stored) ? stored : DEFAULT_SKIN
}

// Two independent axes: `theme` is how bright the app is, `skin` is what it's
// made of. Keeping them separate means a skin never has to ship two designs,
// and the light/dark toggle keeps working exactly as it always did.
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme)
  const [skin, setSkinState] = useState(getInitialSkin)
  const [booting, setBooting] = useState(() => shouldBootOnLoad(getInitialSkin()))

  // Putting on a HUD suit runs the power-on sequence; taking it off, or moving
  // between two flat skins, does not. Switching HUD→HUD does: it's a different
  // identity coming online, which is the moment worth showing.
  const setSkin = useCallback((next) => {
    setSkinState((current) => {
      if (next !== current && isHud(next) && !reducedMotion()) setBooting(true)
      return next
    })
  }, [])

  const endBoot = useCallback(() => setBooting(false), [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    // One attribute drives the whole re-skin: index.css redefines the accent
    // variables under [data-skin], and every component follows automatically.
    document.documentElement.dataset.skin = skin
    // A second attribute for the HUD family, so the shared chassis is ONE CSS
    // block keyed on [data-hud] instead of three identical ones keyed on each
    // identity. Absent entirely for flat skins, which then cost nothing.
    if (isHud(skin)) {
      document.documentElement.dataset.hud = ''
    } else {
      delete document.documentElement.dataset.hud
    }
    localStorage.setItem('skin', skin)
  }, [skin])

  useEffect(() => {
    // Browser/status-bar chrome matches the skin as well as the brightness, so
    // an installed PWA looks deliberate right up to the notch.
    const meta = skinMeta(skin).themeColor
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? meta.dark : meta.light)
  }, [theme, skin])

  // One listener for the whole app instead of an onClick in 400 components.
  // Capture phase, so it still fires for handlers that stop propagation, and
  // only for things that are actually controls — a tap on a paragraph is not
  // an interaction worth a sound.
  useEffect(() => {
    const onTap = (e) => {
      const el = e.target?.closest?.('button, a, [role="button"], summary, label')
      if (!el || el.disabled) return
      playSound('tap', skin)
    }
    document.addEventListener('click', onTap, true)
    return () => document.removeEventListener('click', onTap, true)
  }, [skin])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return (
    <ThemeContext.Provider
      value={{ theme, toggleTheme, skin, setSkin, hud: isHud(skin), booting, endBoot }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
