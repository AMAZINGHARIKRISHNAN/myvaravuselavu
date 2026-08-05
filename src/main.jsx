import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { reloadForNewBuild, clearReloadFlag } from './lib/lazyWithRetry'

// A deploy renames every hashed chunk, so a page left open (or an installed
// PWA whose service worker just swapped itself in) can ask for a file that no
// longer exists. Vite reports that as `vite:preloadError`; the honest response
// is to pick up the new build rather than show an error screen.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  reloadForNewBuild()
})

// Booted fine — let the next deploy during this session reload once too.
window.addEventListener('load', clearReloadFlag)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Clear the pre-React splash (see index.html) once the app has actually
// painted. Two frames, not a timeout: the first lets React commit, the second
// lets the browser paint it, so the reactor never cross-fades onto a half-drawn
// screen. Removed from the DOM after the fade so it can't swallow a tap.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById('boot')
    if (!splash) return
    splash.classList.add('gone')
    splash.addEventListener('transitionend', () => splash.remove(), { once: true })
    // Belt and braces: if the transition never fires (reduced motion, hidden
    // tab), take it out anyway rather than leaving an invisible overlay.
    setTimeout(() => splash.remove(), 800)
  })
})
