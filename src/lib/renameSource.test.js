import { describe, it, expect } from 'vitest'
import { detectRenames, retagOps, retagAllOps, SOURCE_FIELDS } from './renameSource'

describe('spotting a rename', () => {
  const before = [
    { id: 'a1', label: 'MUFG', country: 'JP' },
    { id: 'a2', label: 'PNB', country: 'IN' },
  ]

  it('matches by id, so a typo fix is a rename and not a new account', () => {
    const after = [
      { id: 'a1', label: 'MUFJ', country: 'JP' },
      { id: 'a2', label: 'PNB', country: 'IN' },
    ]
    expect(detectRenames(before, after)).toEqual([{ from: 'MUFG', to: 'MUFJ' }])
  })

  it('ignores an account that was added or removed', () => {
    const after = [...before, { id: 'a3', label: 'SBI', country: 'IN' }]
    expect(detectRenames(before, after)).toEqual([])
    expect(detectRenames(before, [before[0]])).toEqual([])
  })

  it('ignores a blank label', () => {
    expect(detectRenames(before, [{ id: 'a1', label: '  ' }])).toEqual([])
  })
})

describe('re-tagging the records that named the old label', () => {
  it('rewrites the source field, leaving other records alone', () => {
    const expenses = [
      { id: 'e1', paymentMethod: 'MUFG', amount: 500 },
      { id: 'e2', paymentMethod: 'Cash', amount: 300 },
    ]
    expect(retagOps('expenses', expenses, 'MUFG', 'MUFJ')).toEqual([
      { op: 'update', name: 'expenses', id: 'e1', data: { paymentMethod: 'MUFJ' } },
    ])
  })

  it('handles both sides of a transfer independently', () => {
    const transfers = [
      { id: 't1', fromAccount: 'MUFG', toAccount: 'ICICI' },
      { id: 't2', fromAccount: 'Rakuten', toAccount: 'MUFG' },
      { id: 't3', fromAccount: 'MUFG', toAccount: 'MUFG' },
    ]
    const ops = retagOps('transfers', transfers, 'MUFG', 'MUFJ')
    expect(ops.map((o) => o.data)).toEqual([
      { fromAccount: 'MUFJ' },
      { toAccount: 'MUFJ' },
      { fromAccount: 'MUFJ', toAccount: 'MUFJ' },
    ])
  })

  it('does nothing when the name did not actually change', () => {
    const rows = [{ id: 'e1', paymentMethod: 'MUFJ' }]
    expect(retagOps('expenses', rows, 'MUFJ', 'MUFJ')).toEqual([])
    expect(retagOps('expenses', rows, '', 'MUFJ')).toEqual([])
  })

  it('covers every collection that can name a source', () => {
    expect(SOURCE_FIELDS.map((c) => c.name)).toEqual([
      'expenses',
      'income',
      'transfers',
      'pasmoRecharges',
      'officeReimbursements',
      'commutePasses',
      'withdrawals',
      'accountEntries',
      'groupExpenses',
      'recurring',
    ])
  })

  it('collects one flat write list across every collection', () => {
    const loaded = {
      expenses: [{ id: 'e1', paymentMethod: 'MUFG' }],
      withdrawals: [{ id: 'w1', account: 'MUFG' }],
      accountEntries: [{ id: 'ae1', account: 'MUFG' }],
      income: [{ id: 'i1', account: 'Cash' }],
    }
    const ops = retagAllOps([{ from: 'MUFG', to: 'MUFJ' }], loaded)
    expect(ops).toHaveLength(3)
    expect(ops.every((o) => o.op === 'update')).toBe(true)
  })
})
