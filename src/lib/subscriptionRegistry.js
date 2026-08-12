// One live Firestore listener per key, shared by everyone who asks for it.
//
// Without this, every component that wants the same data opens its own
// onSnapshot: the Dashboard alone had five copies of the settings document and
// two of the recurring list, each with its own network attach and its own share
// of the free plan's read quota. Consumers are ref-counted, so the listener is
// opened by the first one and closed by the last, and a component mounting late
// is handed whatever is already cached without waiting or re-reading.
//
// `subscribe` is a thunk rather than a function of arguments, so the registry
// never has to know what it is subscribing to — collections, a settings
// document and the recurring list all key differently and all share this.

// How long a listener outlives its last consumer.
//
// Dropping it the instant the count hits zero made every navigation a teardown
// and a full rebuild: leaving the Dashboard closed sixteen listeners, and
// coming back reopened all sixteen, re-read every document and flashed a
// skeleton over data the app had held moments earlier. Tab-hopping is the
// normal way this app is used, so the normal case was the expensive one.
//
// Keeping the listener warm for a minute makes going back instant and free —
// the data is already there, already fresh (snapshots keep arriving while it
// idles), and nothing is re-read. A genuine departure still tears down, just
// a minute later.
export const GRACE_MS = 60_000

export function createSharedRegistry({ initialData = null, graceMs = GRACE_MS } = {}) {
  const registry = new Map()

  const teardown = (key, entry) => {
    entry.unsub?.()
    // Only if this exact entry is still the one filed under the key — a
    // re-acquire during the grace period replaces it, and closing that would
    // kill a listener someone is actively using.
    if (registry.get(key) === entry) registry.delete(key)
  }

  function acquire(key, subscribe, onState) {
    let entry = registry.get(key)
    if (entry?.closeTimer) {
      // Reclaimed inside the grace window: cancel the teardown and reuse
      // everything — no network attach, no loading state, no re-read.
      clearTimeout(entry.closeTimer)
      entry.closeTimer = null
    }
    if (!entry) {
      entry = {
        data: initialData,
        loading: true,
        error: null,
        refs: 0,
        listeners: new Set(),
        unsub: null,
        closeTimer: null,
      }
      registry.set(key, entry)
      const emit = () => entry.listeners.forEach((fn) => fn(entry))
      entry.unsub = subscribe({
        onData: (data) => {
          entry.data = data
          entry.loading = false
          entry.error = null
          emit()
        },
        onError: (error) => {
          entry.error = error
          entry.loading = false
          emit()
        },
      })
    }
    entry.refs += 1
    entry.listeners.add(onState)
    onState(entry) // hand over whatever is cached right now

    let released = false
    return () => {
      // Guard against a double release: React can run a cleanup twice in
      // StrictMode, and decrementing past zero would close a listener that
      // other components are still using.
      if (released) return
      released = true
      entry.listeners.delete(onState)
      entry.refs -= 1
      if (entry.refs > 0) return
      if (graceMs > 0) {
        entry.closeTimer = setTimeout(() => {
          entry.closeTimer = null
          teardown(key, entry)
        }, graceMs)
      } else {
        teardown(key, entry)
      }
    }
  }

  // Everything, closed now. Sign-out uses this: a listener left running against
  // a signed-out user's documents only produces permission errors.
  function clear() {
    for (const [key, entry] of registry) {
      if (entry.closeTimer) clearTimeout(entry.closeTimer)
      teardown(key, entry)
    }
    registry.clear()
  }

  return { acquire, clear, size: () => registry.size }
}
