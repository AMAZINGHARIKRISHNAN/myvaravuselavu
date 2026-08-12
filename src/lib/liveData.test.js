import { describe, it, expect, vi } from 'vitest'
import { registerLiveData, closeAllLiveData } from './liveData'
import { createSharedRegistry } from './subscriptionRegistry'

// Listeners outlive their last consumer so navigation is free. Sign-out is the
// one moment that must not be free: a warm listener on the previous user's
// documents would keep reading with revoked permissions.
describe('closing every live listener at sign-out', () => {
  it('closes registries from every hook at once', () => {
    const unsubA = vi.fn()
    const unsubB = vi.fn()
    const a = registerLiveData(createSharedRegistry({ initialData: [] }))
    const b = registerLiveData(createSharedRegistry({ initialData: null }))
    a.acquire('expenses', () => unsubA, () => {})
    b.acquire('settings', () => unsubB, () => {})

    closeAllLiveData()

    expect(unsubA).toHaveBeenCalledTimes(1)
    expect(unsubB).toHaveBeenCalledTimes(1)
    expect(a.size()).toBe(0)
    expect(b.size()).toBe(0)
  })

  it('closes one that is already winding down inside its grace period', () => {
    vi.useFakeTimers()
    const unsub = vi.fn()
    const r = registerLiveData(createSharedRegistry({ initialData: [] }))
    r.acquire('expenses', () => unsub, () => {})()
    expect(r.size()).toBe(1) // warm

    closeAllLiveData()
    expect(unsub).toHaveBeenCalledTimes(1)
    expect(r.size()).toBe(0)

    // and its pending timer must not fire into a closed registry
    vi.advanceTimersByTime(120_000)
    expect(unsub).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('is safe to call with nothing open', () => {
    expect(() => closeAllLiveData()).not.toThrow()
  })

  it('leaves a registry usable afterwards, for the next sign-in', () => {
    const subscribe = vi.fn(() => vi.fn())
    const r = registerLiveData(createSharedRegistry({ initialData: [] }))
    r.acquire('expenses', subscribe, () => {})
    closeAllLiveData()
    r.acquire('expenses', subscribe, () => {})
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(r.size()).toBe(1)
  })
})
