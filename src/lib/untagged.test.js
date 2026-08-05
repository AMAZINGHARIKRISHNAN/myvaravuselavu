import { describe, it, expect } from 'vitest'
import { findUntagged, assignOps, knownSources } from './untagged'

const accounts = [
  { id: 'a1', label: 'MUFJ', country: 'JP' },
  { id: 'a2', label: 'ICICI NRE', country: 'IN' },
]

describe('finding money that moves no balance', () => {
  it('flags income that never named an account', () => {
    const rows = findUntagged({
      income: [{ id: 'i1', amount: 200000, source: 'Salary', date: new Date('2026-07-25') }],
      accounts,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ collection: 'income', field: 'account', reason: 'none' })
  })

  it('flags records still pointing at a renamed account', () => {
    const rows = findUntagged({
      income: [{ id: 'i1', amount: 5000, account: 'MUFG', date: new Date('2026-07-20') }],
      expenses: [{ id: 'e1', amount: 500, paymentMethod: 'MUFG', date: new Date('2026-07-21') }],
      accounts,
    })
    expect(rows.map((r) => r.reason)).toEqual(['unknown', 'unknown'])
    expect(rows.map((r) => r.collection)).toEqual(['expenses', 'income']) // newest first
  })

  it('leaves healthy records alone — including Cash, UPI and the cards', () => {
    expect(
      findUntagged({
        income: [{ id: 'i1', account: 'MUFJ', date: new Date() }],
        expenses: [
          { id: 'e1', paymentMethod: 'Cash', date: new Date() },
          { id: 'e2', paymentMethod: 'Pasmo', date: new Date() },
          { id: 'e3', paymentMethod: 'UPI', date: new Date() },
          { id: 'e4', paymentMethod: 'ICICI NRE', date: new Date() },
        ],
        accounts,
      })
    ).toEqual([])
  })

  it('knows every source the app recognises', () => {
    const known = knownSources(accounts)
    expect(known.has('MUFJ')).toBe(true)
    expect(known.has('Pasmo')).toBe(true)
    expect(known.has('Cash')).toBe(true)
    expect(known.has('MUFG')).toBe(false)
  })
})

describe('assigning them a home', () => {
  it('writes the right field per collection', () => {
    const rows = [
      { id: 'i1', collection: 'income', field: 'account' },
      { id: 'e1', collection: 'expenses', field: 'paymentMethod' },
    ]
    expect(assignOps(rows, 'MUFJ')).toEqual([
      { op: 'update', name: 'income', id: 'i1', data: { account: 'MUFJ' } },
      { op: 'update', name: 'expenses', id: 'e1', data: { paymentMethod: 'MUFJ' } },
    ])
  })

  it('does nothing without a target', () => {
    expect(assignOps([{ id: 'i1', collection: 'income', field: 'account' }], '')).toEqual([])
  })
})
