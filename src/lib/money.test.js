import { describe, it, expect } from 'vitest'
import { countryOf, inCountry, sumIn, sumByCategory, countryForAccount, monthTotals } from './money'

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

// "Edenred is always yen" — asserted as a property of every total in the app,
// not just of the card balance.
describe('a fixed-currency method overrules a stored country', () => {
  const udon = { id: 'u', amount: 900, paymentMethod: 'Edenred', country: 'IN', category: 'Food' }
  const lunch = { id: 'l', amount: 500, paymentMethod: 'Pasmo', country: 'IN', category: 'Food' }
  const upi = { id: 'x', amount: 700, paymentMethod: 'UPI', country: 'JP', category: 'Food' }

  it('counts card spending in the yen total, never the rupee one', () => {
    expect(sumIn([udon, lunch], 'JP')).toBe(1400)
    expect(sumIn([udon, lunch], 'IN')).toBe(0)
  })

  it('counts UPI spending in the rupee total, never the yen one', () => {
    expect(sumIn([upi], 'IN')).toBe(700)
    expect(sumIn([upi], 'JP')).toBe(0)
  })

  it('keeps the two sides of a category breakdown apart', () => {
    expect(sumByCategory([udon, upi], 'JP')).toEqual({ Food: 900 })
    expect(sumByCategory([udon, upi], 'IN')).toEqual({ Food: 700 })
  })

  it('filters by the currency the method dictates', () => {
    expect(inCountry([udon, upi], 'JP')).toEqual([udon])
    expect(inCountry([udon, upi], 'IN')).toEqual([upi])
  })

  // An office claim names the card in a different field; the rule is the same.
  it('applies through paidWith as well as paymentMethod', () => {
    expect(countryOf({ paidWith: 'Edenred', country: 'IN' })).toBe('JP')
    expect(countryOf({ paidWith: 'ICICI', country: 'IN' })).toBe('IN')
  })

  // Cash and bank accounts keep their own country: cash really is both, and an
  // account's currency is the user's to set.
  it('leaves cash and bank records alone', () => {
    expect(countryOf({ paymentMethod: 'Cash', country: 'IN' })).toBe('IN')
    expect(countryOf({ paymentMethod: 'MUFJ', country: 'JP' })).toBe('JP')
    expect(countryOf({ account: 'ICICI', country: 'IN' })).toBe('IN')
  })

  it('still defaults to yen when nothing says otherwise', () => {
    expect(countryOf({})).toBe('JP')
    expect(countryOf(null)).toBe('JP')
  })

  // No total may double-count: whatever a record is, it lands in exactly one.
  it('puts every record in exactly one currency', () => {
    const all = [udon, lunch, upi, { id: 'c', amount: 100, paymentMethod: 'Cash', country: 'IN' }]
    expect(sumIn(all, 'JP') + sumIn(all, 'IN')).toBe(900 + 500 + 700 + 100)
  })
})

// One derivation of the month, used by the dashboard, the review page, the
// charts and the audit. They each had their own before, and they disagreed.
describe('monthTotals', () => {
  const yen = (amount, extra = {}) => ({ amount, ...extra })

  it('adds up what came in, what went out, and what was sent home', () => {
    expect(
      monthTotals({
        income: [yen(300000)],
        expenses: [yen(80000)],
        transfers: [{ amountSent: 50000, amountReceived: 27000 }],
      })
    ).toEqual({
      income: 300000,
      expenses: 80000,
      transfers: 50000,
      saved: 170000,
      savingsRate: 170000 / 300000,
    })
  })

  // The bug this consolidation found: the review page summed rupees and yen
  // together, so an Indian group settlement inflated the month's income.
  it('never lets rupee income into the yen total', () => {
    const totals = monthTotals({
      income: [yen(300000), yen(4000, { country: 'IN' })],
      expenses: [],
      transfers: [],
    })
    expect(totals.income).toBe(300000)
    expect(totals.saved).toBe(300000)
  })

  it('never lets rupee spending into the yen total', () => {
    const totals = monthTotals({
      income: [yen(300000)],
      expenses: [yen(80000), yen(5000, { country: 'IN' })],
      transfers: [],
    })
    expect(totals.expenses).toBe(80000)
  })

  // A card decides its own currency, so this must agree with every other total.
  it('counts a card expense as yen even when stored as rupees', () => {
    const totals = monthTotals({
      income: [],
      expenses: [yen(900, { paymentMethod: 'Edenred', country: 'IN' })],
      transfers: [],
    })
    expect(totals.expenses).toBe(900)
  })

  // A remittance is yen leaving, and amountSent is always the yen figure — so
  // transfers are deliberately NOT country-filtered.
  it('counts what was sent, not what arrived', () => {
    const totals = monthTotals({
      income: [],
      expenses: [],
      transfers: [{ amountSent: 50000, amountReceived: 27000, country: 'IN' }],
    })
    expect(totals.transfers).toBe(50000)
  })

  it('treats an untagged record as yen, like everywhere else', () => {
    expect(monthTotals({ income: [yen(1000)], expenses: [], transfers: [] }).income).toBe(1000)
  })

  // "No income" is not a savings rate of zero — it is no rate at all, and
  // dividing would claim otherwise.
  it('reports no savings rate when nothing came in', () => {
    expect(monthTotals({ income: [], expenses: [yen(500)], transfers: [] }).savingsRate).toBe(null)
  })

  it('allows a negative month without pretending otherwise', () => {
    const totals = monthTotals({ income: [yen(100000)], expenses: [yen(150000)], transfers: [] })
    expect(totals.saved).toBe(-50000)
    expect(totals.savingsRate).toBe(-0.5)
  })

  it('survives being given nothing', () => {
    expect(monthTotals()).toEqual({
      income: 0,
      expenses: 0,
      transfers: 0,
      saved: 0,
      savingsRate: null,
    })
  })
})
