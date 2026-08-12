import { describe, it, expect, vi } from 'vitest'
import { createSharedRegistry, GRACE_MS } from './subscriptionRegistry'

describe('createSharedRegistry', () => {
  it('opens one listener however many consumers ask for the same key', () => {
    const subscribe = vi.fn(() => vi.fn())
    const { acquire, size } = createSharedRegistry()

    acquire('u1', subscribe, () => {})
    acquire('u1', subscribe, () => {})
    acquire('u1', subscribe, () => {})

    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(size()).toBe(1)
  })

  it('closes it only when the last consumer lets go', () => {
    vi.useFakeTimers()
    const unsub = vi.fn()
    const { acquire, size } = createSharedRegistry()
    const a = acquire('u1', () => unsub, () => {})
    const b = acquire('u1', () => unsub, () => {})
    a()
    expect(unsub).not.toHaveBeenCalled()
    b()
    // The last release starts the grace period rather than closing outright,
    // so a consumer returning mid-navigation keeps the live listener.
    expect(unsub).not.toHaveBeenCalled()
    vi.advanceTimersByTime(GRACE_MS)
    expect(unsub).toHaveBeenCalledTimes(1)
    expect(size()).toBe(0)
    vi.useRealTimers()
  })

  it('hands a late consumer the cached value with no second read', () => {
    let push
    const subscribe = vi.fn(({ onData }) => {
      push = onData
      return vi.fn()
    })
    const { acquire } = createSharedRegistry({ initialData: null })

    acquire('u1', subscribe, () => {})
    push({ salaryDate: 25 })

    const seen = []
    acquire('u1', subscribe, (entry) => seen.push(entry))
    expect(seen[0].data).toEqual({ salaryDate: 25 })
    expect(seen[0].loading).toBe(false)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('fans one update out to every consumer', () => {
    let push
    const subscribe = ({ onData }) => {
      push = onData
      return () => {}
    }
    const { acquire } = createSharedRegistry({ initialData: [] })
    const a = []
    const b = []
    acquire('u1', subscribe, (e) => a.push(e.data))
    acquire('u1', subscribe, (e) => b.push(e.data))
    push([{ id: 'x' }])
    expect(a.at(-1)).toHaveLength(1)
    expect(b.at(-1)).toHaveLength(1)
  })

  it('reports an error to consumers and stops loading', () => {
    let fail
    const { acquire } = createSharedRegistry({ initialData: [] })
    const seen = []
    acquire(
      'u1',
      ({ onError }) => {
        fail = onError
        return () => {}
      },
      (e) => seen.push({ ...e })
    )
    fail(new Error('permission denied'))
    expect(seen.at(-1).error.message).toBe('permission denied')
    expect(seen.at(-1).loading).toBe(false)
  })

  it('keeps different keys apart', () => {
    const { acquire, size } = createSharedRegistry()
    acquire('u1', () => () => {}, () => {})
    acquire('u2', () => () => {}, () => {})
    expect(size()).toBe(2)
  })

  // Navigation is the normal case, so it must be the cheap one: the listener
  // outlives its last consumer for a grace period and is reclaimed intact.
  it('reuses the listener when a consumer returns during the grace period', () => {
    vi.useFakeTimers()
    const subscribe = vi.fn(({ onData }) => {
      onData([{ id: 'a' }])
      return vi.fn()
    })
    const { acquire, size } = createSharedRegistry({ initialData: [] })
    acquire('u1', subscribe, () => {})()
    expect(size()).toBe(1) // still warm

    vi.advanceTimersByTime(30_000)
    const seen = []
    acquire('u1', subscribe, (e) => seen.push({ ...e }))
    expect(subscribe).toHaveBeenCalledTimes(1) // no second attach
    expect(seen[0].loading).toBe(false) // and no skeleton
    expect(seen[0].data).toEqual([{ id: 'a' }])
    vi.useRealTimers()
  })

  it('closes for real once the grace period passes', () => {
    vi.useFakeTimers()
    const unsub = vi.fn()
    const subscribe = vi.fn(() => unsub)
    const { acquire, size } = createSharedRegistry()
    acquire('u1', subscribe, () => {})()

    vi.advanceTimersByTime(GRACE_MS - 1)
    expect(size()).toBe(1)
    vi.advanceTimersByTime(1)
    expect(size()).toBe(0)
    expect(unsub).toHaveBeenCalledTimes(1)

    acquire('u1', subscribe, () => {})
    expect(subscribe).toHaveBeenCalledTimes(2) // a genuine departure re-opens
    vi.useRealTimers()
  })

  it('does not close a listener someone reclaimed while it was winding down', () => {
    vi.useFakeTimers()
    const unsub = vi.fn()
    const { acquire, size } = createSharedRegistry()
    acquire('u1', () => unsub, () => {})()
    acquire('u1', () => unsub, () => {}) // reclaimed, timer cancelled
    vi.advanceTimersByTime(GRACE_MS * 2)
    expect(unsub).not.toHaveBeenCalled()
    expect(size()).toBe(1)
    vi.useRealTimers()
  })

  it('tears down immediately when no grace is wanted', () => {
    const unsub = vi.fn()
    const { acquire, size } = createSharedRegistry({ graceMs: 0 })
    acquire('u1', () => unsub, () => {})()
    expect(size()).toBe(0)
    expect(unsub).toHaveBeenCalledTimes(1)
  })

  // React runs effect cleanups twice in StrictMode. Decrementing past zero
  // would close a listener other components are still reading from.
  it('survives a release being called twice', () => {
    const unsub = vi.fn()
    const { acquire, size } = createSharedRegistry({ graceMs: 0 })
    const releaseA = acquire('u1', () => unsub, () => {})
    acquire('u1', () => unsub, () => {})
    releaseA()
    releaseA()
    expect(size()).toBe(1)
    expect(unsub).not.toHaveBeenCalled()
  })

  it('clear() closes everything at once, for sign-out', () => {
    const unsubA = vi.fn()
    const unsubB = vi.fn()
    const { acquire, clear, size } = createSharedRegistry()
    acquire('u1', () => unsubA, () => {})
    acquire('u2', () => unsubB, () => {})
    clear()
    expect(size()).toBe(0)
    expect(unsubA).toHaveBeenCalledTimes(1)
    expect(unsubB).toHaveBeenCalledTimes(1)
  })
})
