import { describe, it, expect } from 'vitest'
import { billsTotal, billsToLog, reconcileDiff, isReconciled, monthTotals } from './audit'

describe('bills', () => {
  const rows = [
    { key: 'rent', label: 'Rent', checked: true, amount: '65000' },
    { key: 'water', label: 'Water', checked: true, amount: '' }, // ticked, no amount yet
    { key: 'gas', label: 'Gas', checked: false, amount: '3000' }, // unticked
    { key: 'elec_gas', label: 'Electricity + Gas', checked: true, amount: '9800' },
  ]

  it('totals only ticked bills with amounts', () => {
    expect(billsTotal(rows)).toBe(65000 + 9800)
  })

  it('lists only what can actually be logged', () => {
    expect(billsToLog(rows)).toEqual([
      { label: 'Rent', amount: 65000 },
      { label: 'Electricity + Gas', amount: 9800 },
    ])
  })
})

describe('reconcileDiff', () => {
  it('is positive when the app thinks you have more than you do', () => {
    expect(reconcileDiff(50000, '48000')).toBe(2000) // ¥2,000 unlogged spending
  })

  it('is negative when you actually have more (unlogged income)', () => {
    expect(reconcileDiff(50000, '52000')).toBe(-2000)
  })

  it('is null until a number is entered', () => {
    expect(reconcileDiff(50000, '')).toBe(null)
    expect(reconcileDiff(50000, 'abc')).toBe(null)
  })

  it('treats a sub-¥1 gap as reconciled', () => {
    expect(isReconciled(reconcileDiff(50000, '50000'))).toBe(true)
    expect(isReconciled(reconcileDiff(50000, '49000'))).toBe(false)
    expect(isReconciled(null)).toBe(false)
  })
})

describe('monthTotals', () => {
  it('adds up income, JP expenses and transfers into saved', () => {
    const t = monthTotals({
      income: [{ amount: 200000 }],
      expenses: [{ amount: 30000 }, { amount: 5000, country: 'IN' }],
      transfers: [{ amountSent: 50000 }],
    })
    expect(t.income).toBe(200000)
    expect(t.expenses).toBe(30000) // INR expense excluded from the yen line
    expect(t.transfers).toBe(50000)
    expect(t.saved).toBe(120000)
    expect(t.savingsRate).toBeCloseTo(0.6)
  })
})
