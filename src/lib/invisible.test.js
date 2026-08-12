import { describe, it, expect } from 'vitest'
import { COLLECTIONS_WITH_DATES, describeDateless, repairDatelessOps } from './invisible'

const at = (iso) => new Date(iso)

describe('collections that can hide a record', () => {
  it('covers the ones every screen reads through the ordered query', () => {
    for (const name of ['expenses', 'income', 'transfers', 'pasmoRecharges', 'withdrawals']) {
      expect(COLLECTIONS_WITH_DATES).toContain(name)
    }
  })

  it('lists each collection once', () => {
    expect(new Set(COLLECTIONS_WITH_DATES).size).toBe(COLLECTIONS_WITH_DATES.length)
  })
})

describe('describeDateless', () => {
  it('says what was found, not just how much', () => {
    const found = [
      { id: '1', collection: 'expenses' },
      { id: '2', collection: 'expenses' },
      { id: '3', collection: 'income' },
    ]
    expect(describeDateless(found)).toBe('2 expenses, 1 income')
  })

  it('is empty when nothing is hidden', () => {
    expect(describeDateless([])).toBe('')
    expect(describeDateless()).toBe('')
  })
})

describe('repairDatelessOps', () => {
  // The honest date is when the record was actually written. Using today would
  // move real spending into the wrong month — corrupting a total in order to
  // fix a different problem.
  it('restores the date the record was written', () => {
    const found = [{ id: 'e1', collection: 'expenses', createdAt: at('2026-06-15'), amount: 900 }]
    expect(repairDatelessOps(found)).toEqual([
      { op: 'update', name: 'expenses', id: 'e1', data: { date: at('2026-06-15') } },
    ])
  })

  it('falls back to now only when even that is missing', () => {
    const now = at('2026-08-12')
    const ops = repairDatelessOps([{ id: 'e1', collection: 'expenses' }], now)
    expect(ops[0].data.date).toBe(now)
  })

  it('writes nothing else — a repair must not invent an amount or a category', () => {
    const found = [{ id: 'e1', collection: 'expenses', createdAt: at('2026-06-15'), amount: 900 }]
    expect(Object.keys(repairDatelessOps(found)[0].data)).toEqual(['date'])
  })

  it('targets each record in its own collection', () => {
    const found = [
      { id: 'e1', collection: 'expenses', createdAt: at('2026-06-01') },
      { id: 'i1', collection: 'income', createdAt: at('2026-06-02') },
    ]
    expect(repairDatelessOps(found).map((o) => o.name)).toEqual(['expenses', 'income'])
  })

  // A row with no id cannot be addressed, and writing it as a `set` would
  // create a duplicate of a record that already exists.
  it('skips anything it cannot address', () => {
    const found = [
      { collection: 'expenses', createdAt: at('2026-06-01') },
      { id: 'e2', createdAt: at('2026-06-01') },
      { id: 'e3', collection: 'expenses', createdAt: at('2026-06-01') },
    ]
    expect(repairDatelessOps(found)).toHaveLength(1)
    expect(repairDatelessOps(found)[0].id).toBe('e3')
  })

  it('survives finding nothing', () => {
    expect(repairDatelessOps([])).toEqual([])
    expect(repairDatelessOps()).toEqual([])
  })

  // Every op is an update, never a set: these records exist, and re-creating
  // them would duplicate rather than repair.
  it('only ever updates', () => {
    const found = [{ id: 'e1', collection: 'expenses', createdAt: at('2026-06-01') }]
    expect(repairDatelessOps(found).every((o) => o.op === 'update')).toBe(true)
  })
})
