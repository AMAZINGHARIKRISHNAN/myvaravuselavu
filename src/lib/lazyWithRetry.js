import { lazy } from 'react'

// Pages load on demand, by hashed filename: `Charts-DUwcLzUo.js`. Deploying
// rewrites those hashes and the old files stop existing — so a tab that was
// already open (or an installed PWA whose service worker just swapped itself
// in) asks for a chunk that is gone, the import rejects, and the whole screen
// becomes "Something went wrong" for what is really just a stale page.
//
// Reloading fixes it, so do that instead of showing an error: one reload picks
// up the new index and the new chunk names. If the very next attempt fails too,
// it's a real failure (a bad deploy, a chunk that genuinely 404s) and the error
// boundary should see it rather than the page reloading forever.
//
// What stops the loop is a TIMESTAMP, not a boolean. A boolean needs someone to
// clear it, and the obvious place to do that — "the app booted, so let the next
// deploy reload too" — runs on every load, including the one the reload just
// caused. That cleared the guard before it could ever be read, so a missing
// chunk reloaded endlessly. A timestamp needs nobody: a chunk that fails again
// straight after a reload is inside the window and gives up, while a second
// deploy an hour later is outside it and gets its own reload.
const RELOAD_FLAG = 'vs_chunk_reloaded_at'

// Long enough to cover the reload plus the router re-requesting the same lazy
// route (a second or two); short enough that it never blocks a genuine later
// deploy in the same session.
const RETRY_WINDOW_MS = 15_000

// Browsers word a missing chunk differently; this catches all of them.
export function isStaleChunkError(error) {
  const text = `${error?.message || ''} ${error?.name || ''}`
  return /Loading chunk|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    text
  )
}

// Safari in private mode can throw on storage access, and a reload that can't
// remember it happened would loop — so failing to read means "already tried".
export function reloadedRecently(now = Date.now()) {
  try {
    const at = parseInt(sessionStorage.getItem(RELOAD_FLAG) || '', 10)
    if (!Number.isFinite(at)) return false
    // A clock that jumped backwards must not park the guard on forever.
    return at <= now && now - at < RETRY_WINDOW_MS
  } catch {
    return true
  }
}

function markReloaded(now = Date.now()) {
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(now))
  } catch {
    /* storage unavailable — reloadedRecently() fails closed, so one attempt */
  }
}

// Called once a lazy chunk has actually loaded: chunks demonstrably work, so
// nothing is left to guard against and the next deploy starts from scratch.
export const clearReloadFlag = () => {
  try {
    sessionStorage.removeItem(RELOAD_FLAG)
  } catch {
    /* nothing to clear */
  }
}

export function reloadForNewBuild() {
  if (reloadedRecently()) return false
  markReloaded()
  window.location.reload()
  return true
}

export function lazyWithRetry(factory) {
  return lazy(async () => {
    try {
      const mod = await factory()
      // Got there — a later deploy during this session gets its own reload.
      clearReloadFlag()
      return mod
    } catch (error) {
      if (reloadForNewBuild()) {
        // The page is on its way out; render nothing in the meantime.
        return { default: () => null }
      }
      throw error
    }
  })
}
