import { describe, it, expect, vi } from 'vitest'
import { createRegistry, keyFor } from './useCollection'

describe('shared subscription registry', () => {
  it('opens ONE listener for many consumers of the same collection+range', () => {
    const subscribe = vi.fn(() => vi.fn())
    const { acquire, size } = createRegistry(subscribe)

    const r1 = acquire('u', 'expenses', undefined, () => {})
    const r2 = acquire('u', 'expenses', undefined, () => {})
    const r3 = acquire('u', 'expenses', undefined, () => {})

    expect(subscribe).toHaveBeenCalledTimes(1) // not 3
    expect(size()).toBe(1)

    r1()
    r2()
    r3()
  })

  it('keeps the listener alive until the LAST consumer releases', () => {
    const unsub = vi.fn()
    const subscribe = vi.fn(() => unsub)
    const { acquire, size } = createRegistry(subscribe)

    const a = acquire('u', 'income', undefined, () => {})
    const b = acquire('u', 'income', undefined, () => {})

    a()
    expect(unsub).not.toHaveBeenCalled() // b still needs it
    expect(size()).toBe(1)
    b()
    expect(unsub).toHaveBeenCalledTimes(1) // now torn down
    expect(size()).toBe(0)
  })

  it('gives a late consumer the already-loaded data immediately', () => {
    let push
    const subscribe = vi.fn((uid, name, { onData }) => {
      push = onData
      return vi.fn()
    })
    const { acquire } = createRegistry(subscribe)

    acquire('u', 'expenses', undefined, () => {})
    push([{ id: 'a' }, { id: 'b' }]) // data arrives

    const seen = []
    const release = acquire('u', 'expenses', undefined, (e) => seen.push(e))
    expect(seen[0].data).toHaveLength(2) // handed the cache, no refetch
    expect(seen[0].loading).toBe(false)
    expect(subscribe).toHaveBeenCalledTimes(1)
    release()
  })

  it('separates different collections and different date ranges', () => {
    const subscribe = vi.fn(() => vi.fn())
    const { acquire, size } = createRegistry(subscribe)
    const range = { start: new Date('2026-07-01') }

    acquire('u', 'expenses', undefined, () => {})
    acquire('u', 'income', undefined, () => {})
    acquire('u', 'expenses', range, () => {}) // same name, different range → own listener

    expect(size()).toBe(3)
    expect(subscribe).toHaveBeenCalledTimes(3)
  })

  it('fans an update out to every live consumer', () => {
    let push
    const subscribe = (uid, name, { onData }) => {
      push = onData
      return () => {}
    }
    const { acquire } = createRegistry(subscribe)
    const a = []
    const b = []
    acquire('u', 'transfers', undefined, (e) => a.push(e.data))
    acquire('u', 'transfers', undefined, (e) => b.push(e.data))
    push([{ id: 'x' }])
    expect(a.at(-1)).toHaveLength(1)
    expect(b.at(-1)).toHaveLength(1) // both notified from one listener
  })
})

describe('keyFor', () => {
  it('collapses no-range calls and distinguishes ranges', () => {
    expect(keyFor('u', 'expenses')).toBe(keyFor('u', 'expenses', undefined))
    expect(keyFor('u', 'expenses', { start: new Date(1) })).not.toBe(keyFor('u', 'expenses'))
  })
})
