import { lazy } from 'react'

// Pages load on demand, by hashed filename: `Charts-DUwcLzUo.js`. Deploying
// rewrites those hashes and the old files stop existing — so a tab that was
// already open (or an installed PWA whose service worker just swapped itself
// in) asks for a chunk that is gone, the import rejects, and the whole screen
// becomes "Something went wrong" for what is really just a stale page.
//
// Reloading fixes it, so do that instead of showing an error: one reload picks
// up the new index and the new chunk names. The flag makes it exactly one — if
// the very next attempt fails too, it's a real failure and the error boundary
// should see it.
const RELOAD_FLAG = 'vs_chunk_reloaded'

// Browsers word a missing chunk differently; this catches all of them.
export function isStaleChunkError(error) {
  const text = `${error?.message || ''} ${error?.name || ''}`
  return /Loading chunk|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    text
  )
}

// Safari in private mode can throw on storage access, and a reload that can't
// remember it happened would loop — so failing to read means "don't retry".
const flag = {
  get() {
    try {
      return sessionStorage.getItem(RELOAD_FLAG)
    } catch {
      return '1'
    }
  },
  set(value) {
    try {
      if (value) sessionStorage.setItem(RELOAD_FLAG, '1')
      else sessionStorage.removeItem(RELOAD_FLAG)
    } catch {
      /* storage unavailable — one attempt is all we get */
    }
  },
}

// Called once the app has booted and stayed up: the next deploy during this
// session deserves its own reload.
export const clearReloadFlag = () => flag.set(false)

export function reloadForNewBuild() {
  if (flag.get()) return false
  flag.set(true)
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
