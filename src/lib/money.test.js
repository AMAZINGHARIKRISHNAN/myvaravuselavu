import { describe, it, expect } from 'vitest'
import { countryOf, inCountry, sumIn, sumByCategory, countryForAccount } from './money'

const records = [
  { id: 'a', amount: 1000, category: 'Food' }, // no country → yen, as it always was
  { id: 'b', amount: 500, category: 'Food', country: 'JP' },
  { id: 'c', amount: 200, category: 'Food', country: 'IN' },
  { id: 'd', amount: 4760, category: 'Transport', country: 'IN' },
]

describe('what currency a record is', () => {
  it('treats records written before the country field as yen', () => {
    expect(countryOf({ amount: 1 })).toBe('JP')
    expect(countryOf({ amount: 1, country: 'IN' })).toBe('IN')
  })
})

describe('sums never mix currencies', () => {
  it('adds only yen for a yen total', () => {
    expect(sumIn(records)).toBe(1500)
  })

  it('adds only rupees for a rupee total', () => {
    expect(sumIn(records, 'IN')).toBe(4960)
  })

  it('reads whichever field holds the amount', () => {
    const transfers = [
      { amountSent: 100000, country: 'JP' },
      { amountSent: 50000, country: 'IN' },
    ]
    expect(sumIn(transfers, 'JP', (t) => t.amountSent)).toBe(100000)
  })

  it('filters a list down to one currency', () => {
    expect(inCountry(records, 'IN').map((r) => r.id)).toEqual(['c', 'd'])
  })
})

describe('budgets are set in yen, so only yen spending counts against them', () => {
  it('keeps rupee spending out of the category totals', () => {
    expect(sumByCategory(records)).toEqual({ Food: 1500 })
  })

  it('still totals the rupee side when asked for it', () => {
    expect(sumByCategory(records, 'IN')).toEqual({ Food: 200, Transport: 4760 })
  })
})

describe('income takes its currency from the account it landed in', () => {
  const accounts = [
    { label: 'MUFJ', country: 'JP' },
    { label: 'ICICI NRE', country: 'IN' },
  ]

  it('rupees for an Indian account, yen for a Japanese one', () => {
    expect(countryForAccount(accounts, 'ICICI NRE')).toBe('IN')
    expect(countryForAccount(accounts, 'MUFJ')).toBe('JP')
  })

  it('falls back to yen for cash, no account, or an unknown name', () => {
    expect(countryForAccount(accounts, 'Cash')).toBe('JP')
    expect(countryForAccount(accounts, '')).toBe('JP')
    expect(countryForAccount(accounts, 'Gone Bank')).toBe('JP')
  })
})
