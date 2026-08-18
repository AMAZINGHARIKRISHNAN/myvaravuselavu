import { describe, it, expect } from 'vitest'
import { isUnfunded, unfundedPurchases } from './friendLedger'

// The hole: a repayment credits an account, but nothing ever debited one when
// the money went out. Collect on such a row and the balance rises from money
// that never left.
describe('friend purchases nothing recorded the money leaving', () => {
  const LEDGER = [
    // Added from the Friends form — no linked expense, money never left.
    { id: 'a', friend: 'Kenji', item: 'Concert ticket', cost: 8000, paid: 8000, due: 8000, country: 'JP' },
    { id: 'b', friend: 'Arun', item: 'Groceries', cost: 3000, paid: 3000, due: 3000, country: 'JP' },
    { id: 'c', friend: 'Ravi', item: 'Medicine', cost: 1450, paid: 1450, due: 1450, country: 'IN' },
    // Created from the entry sheet, which writes both records and links them.
    { id: 'd', friend: 'Kenji', item: 'Lunch', cost: 1200, paid: 1200, due: 1200, country: 'JP', expenseId: 'e1' },
    // Nothing has left your pocket for this one yet.
    { id: 'e', friend: 'Arun', item: 'Preorder', cost: 5000, paid: 0, due: 5000, country: 'JP' },
  ]

  it('finds the rows with no money movement behind them', () => {
    const out = unfundedPurchases(LEDGER)
    expect(out.rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(out.count).toBe(3)
  })

  it('leaves a row the entry sheet created alone', () => {
    expect(isUnfunded(LEDGER.find((p) => p.id === 'd'))).toBe(false)
  })

  it('ignores one where nothing has been paid out yet', () => {
    expect(isUnfunded(LEDGER.find((p) => p.id === 'e'))).toBe(false)
  })

  it('totals them per currency, never mixing the two', () => {
    expect(unfundedPurchases(LEDGER).totals).toEqual([
      { country: 'JP', amount: 11000, count: 2 },
      { country: 'IN', amount: 1450, count: 1 },
    ])
  })

  it('shows the biggest first, since that is the one worth checking', () => {
    expect(unfundedPurchases(LEDGER).rows[0].id).toBe('a')
  })

  it('reads what actually left, not what it cost', () => {
    // Cost 5,000 but only 2,000 has left your pocket so far.
    const partial = [{ id: 'p', cost: 5000, paid: 2000, due: 5000, country: 'JP' }]
    expect(unfundedPurchases(partial).totals[0].amount).toBe(2000)
  })

  it('falls back to the cost when paid was never recorded', () => {
    expect(unfundedPurchases([{ id: 'q', cost: 700, country: 'JP' }]).totals[0].amount).toBe(700)
  })

  it('says nothing about an empty or broken ledger', () => {
    expect(unfundedPurchases([]).count).toBe(0)
    expect(unfundedPurchases().count).toBe(0)
    expect(() => unfundedPurchases([null, {}, undefined])).not.toThrow()
  })

  // It reports. It does not fix.
  it('never changes a row it reports on', () => {
    const before = JSON.stringify(LEDGER)
    unfundedPurchases(LEDGER)
    expect(JSON.stringify(LEDGER)).toBe(before)
  })
})
