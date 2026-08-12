import { describe, it, expect, vi } from 'vitest'
import { createRegistry, keyFor } from './useCollection'
import { GRACE_MS } from '../lib/subscriptionRegistry'
import { withinRange } from '../lib/dateRanges'

describe('shared subscription registry', () => {
  it('opens ONE listener for many consumers of the same collection', () => {
    const subscribe = vi.fn(() => vi.fn())
    const { acquire, size } = createRegistry(subscribe)

    const r1 = acquire('u', 'expenses', () => {})
    const r2 = acquire('u', 'expenses', () => {})
    const r3 = acquire('u', 'expenses', () => {})

    expect(subscribe).toHaveBeenCalledTimes(1) // not 3
    expect(size()).toBe(1)

    r1()
    r2()
    r3()
  })

  it('keeps the listener alive until the LAST consumer releases', () => {
    vi.useFakeTimers()
    const unsub = vi.fn()
    const subscribe = vi.fn(() => unsub)
    const { acquire, size } = createRegistry(subscribe)

    const a = acquire('u', 'income', () => {})
    const b = acquire('u', 'income', () => {})

    a()
    expect(unsub).not.toHaveBeenCalled() // b still needs it
    expect(size()).toBe(1)
    b()
    // The last release begins a grace period instead of closing at once, so
    // navigating away and straight back costs nothing.
    expect(unsub).not.toHaveBeenCalled()
    vi.advanceTimersByTime(GRACE_MS)
    expect(unsub).toHaveBeenCalledTimes(1)
    expect(size()).toBe(0)
    vi.useRealTimers()
  })

  it('serves a returning page from the warm listener, with no re-read', () => {
    vi.useFakeTimers()
    // createRegistry passes (uid, name, handlers) through to Firestore.
    const subscribe = vi.fn((_uid, _name, { onData }) => {
      onData([{ id: 'e1', amount: 900 }])
      return vi.fn()
    })
    const { acquire } = createRegistry(subscribe)

    // Dashboard mounts, then the user taps through to History.
    acquire('u', 'expenses', () => {})()
    vi.advanceTimersByTime(5_000)

    // ...and comes back. No second attach, no skeleton, no billed reads.
    const seen = []
    acquire('u', 'expenses', (e) => seen.push({ ...e }))
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(seen[0].loading).toBe(false)
    expect(seen[0].data).toEqual([{ id: 'e1', amount: 900 }])
    vi.useRealTimers()
  })

  it('gives a late consumer the already-loaded data immediately', () => {
    let push
    const subscribe = vi.fn((uid, name, { onData }) => {
      push = onData
      return vi.fn()
    })
    const { acquire } = createRegistry(subscribe)

    acquire('u', 'expenses', () => {})
    push([{ id: 'a' }, { id: 'b' }]) // data arrives

    const seen = []
    const release = acquire('u', 'expenses', (e) => seen.push(e))
    expect(seen[0].data).toHaveLength(2) // handed the cache, no refetch
    expect(seen[0].loading).toBe(false)
    expect(subscribe).toHaveBeenCalledTimes(1)
    release()
  })

  it('separates different collections, and different users', () => {
    const subscribe = vi.fn(() => vi.fn())
    const { acquire, size } = createRegistry(subscribe)

    acquire('u', 'expenses', () => {})
    acquire('u', 'income', () => {})
    acquire('other', 'expenses', () => {})

    expect(size()).toBe(3)
    expect(subscribe).toHaveBeenCalledTimes(3)
  })

  // The point of the change: the Dashboard wanted this month, last month and
  // all time at once. That used to be three listeners over one collection,
  // where the widest already contained the other two.
  it('serves every date window a screen wants from ONE listener', () => {
    const subscribe = vi.fn(() => vi.fn())
    const { acquire, size } = createRegistry(subscribe)

    acquire('u', 'expenses', () => {}) // all-time (AccountsCard, GlanceStrip)
    acquire('u', 'expenses', () => {}) // this month (Dashboard)
    acquire('u', 'expenses', () => {}) // last month (Dashboard)

    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(size()).toBe(1)
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
    acquire('u', 'transfers', (e) => a.push(e.data))
    acquire('u', 'transfers', (e) => b.push(e.data))
    push([{ id: 'x' }])
    expect(a.at(-1)).toHaveLength(1)
    expect(b.at(-1)).toHaveLength(1) // both notified from one listener
  })
})

describe('keyFor', () => {
  it('keys by user and collection only, so ranges cannot fragment it', () => {
    expect(keyFor('u', 'expenses')).toBe(keyFor('u', 'expenses'))
    expect(keyFor('u', 'expenses')).not.toBe(keyFor('u', 'income'))
    expect(keyFor('u', 'expenses')).not.toBe(keyFor('other', 'expenses'))
  })
})

// The window the server used to apply. It has to behave identically, because
// every month total in the app now depends on it.
describe('withinRange', () => {
  const at = (iso) => ({ id: iso, date: new Date(iso) })
  const records = [at('2026-06-15'), at('2026-07-01'), at('2026-07-20'), at('2026-08-01')]

  it('returns everything when no window is given', () => {
    expect(withinRange(records)).toBe(records)
    expect(withinRange(records, {})).toBe(records)
  })

  it('includes both ends, matching the >= and <= it replaces', () => {
    const got = withinRange(records, { start: new Date('2026-07-01'), end: new Date('2026-07-20') })
    expect(got.map((r) => r.id)).toEqual(['2026-07-01', '2026-07-20'])
  })

  it('handles an open start or an open end', () => {
    expect(withinRange(records, { end: new Date('2026-07-01') })).toHaveLength(2)
    expect(withinRange(records, { start: new Date('2026-07-20') })).toHaveLength(2)
  })

  // Firestore never returns documents missing the field being ordered on, so a
  // dateless record was invisible to a ranged query. Keeping that exact
  // behaviour means no total changes as a result of this move.
  it('leaves out a record with no date, as the query did', () => {
    const withNull = [...records, { id: 'nodate' }]
    const got = withinRange(withNull, { start: new Date('2026-01-01') })
    expect(got.map((r) => r.id)).not.toContain('nodate')
  })

  it('reads a Firestore Timestamp as well as a Date', () => {
    const ts = { id: 'ts', date: { toDate: () => new Date('2026-07-10') } }
    expect(
      withinRange([ts], { start: new Date('2026-07-01'), end: new Date('2026-07-31') })
    ).toHaveLength(1)
  })

  it('survives an empty collection', () => {
    expect(withinRange([], { start: new Date() })).toEqual([])
    expect(withinRange(undefined, { start: new Date() })).toEqual([])
  })
})
