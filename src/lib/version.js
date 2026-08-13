// Which build of the app you are actually running.
//
// A PWA makes this a real question rather than a pedantic one: the copy on your
// home screen is served from the service worker's cache, so "I deployed it" and
// "I am using it" are different events, sometimes days apart. Without a build
// stamp on screen there is no way to tell whether the fix you are looking for
// is in front of you or still waiting behind a stale cache.
//
// Version alone is not enough — two deploys can share a version number. The
// BUILD TIME cannot be shared, so it is what actually identifies a build.

// Injected by vite (see vite.config.js). The fallbacks keep tests and `vite
// dev` working, where these are not defined.
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
export const APP_COMMIT = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : ''
export const BUILT_AT = typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : ''

const KEY = 'vs_seen_build'

// What the app was the last time it ran here, so an update can be reported
// rather than just silently happening. Stored per device, because that is what
// the question is about: this phone's copy, not the server's.
export function readSeenBuild(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY)
    if (!raw) return null
    const seen = JSON.parse(raw)
    return seen && typeof seen.version === 'string' ? seen : null
  } catch {
    return null
  }
}

export function writeSeenBuild(build, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(build))
  } catch {
    // A full or blocked storage must not break the page over a version label.
  }
}

// The current build, the one before it, and whether they differ.
//
// `updated` is true only when a PREVIOUS build was recorded and differs. A
// first run has nothing to compare against, and announcing "updated" then
// would be a lie — you have not updated from anything.
export function buildState(seen, current = { version: APP_VERSION, builtAt: BUILT_AT, commit: APP_COMMIT }) {
  const updated = Boolean(seen) && (seen.version !== current.version || seen.builtAt !== current.builtAt)
  return { current, previous: updated ? seen : null, updated, first: !seen }
}

// Whether the version number itself moved, as opposed to just a rebuild of the
// same version. Worth distinguishing: one is a release, the other is a deploy.
export const isNewVersion = (state) =>
  Boolean(state.previous) && state.previous.version !== state.current.version

// "1.0.0 · 13 Aug, 14:30" — the version for the release, the time for the
// build, because only the second one is guaranteed to be unique.
export function buildLabel(build, locale = undefined) {
  if (!build) return ''
  const v = `v${build.version}`
  if (!build.builtAt) return v
  const d = new Date(build.builtAt)
  if (Number.isNaN(d.getTime())) return v
  const when = d.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${v} · ${when}`
}
