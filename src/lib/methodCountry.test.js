import { describe, it, expect } from 'vitest'
import { METHOD_COUNTRY, methodCountry, NON_ACCOUNT_PAYMENT_METHODS } from './constants'
import { countryOf } from './money'
import { cardBalance, PREPAID_CARDS } from './wallet'

// The bug this file exists for:
//
// A ¥900 udon lunch paid with Edenred was stored with country 'IN'. The entry
// flow had remembered the previous (rupee) expense's country, and the payment
// grid declared every non-account method country-less, so tapping Edenred did
// not override it. The money vanished from the card it was actually paid with.
//
// Two rules fix it, and both are asserted here: the entry flow can no longer
// write such a record, and countryOf overrules one that already exists —
// Edenred is yen, so a stored 'IN' on an Edenred record is corrupt data rather
// than a preference to be honoured.
describe('payment method currency', () => {
  it('fixes the currency of every method that can only hold one', () => {
    expect(methodCountry('Pasmo')).toBe('JP')
    expect(methodCountry('nimoca')).toBe('JP')
    expect(methodCountry('Edenred')).toBe('JP')
    expect(methodCountry('UPI')).toBe('IN')
  })

  // Notes in your pocket are yen in Japan and rupees in India. Cash is the only
  // method that genuinely has to ask, so it must stay absent.
  it('leaves cash — and only cash — for the user to decide', () => {
    expect(methodCountry('Cash')).toBe(null)
    const asking = NON_ACCOUNT_PAYMENT_METHODS.filter((m) => !methodCountry(m))
    expect(asking).toEqual(['Cash'])
  })

  it('gives every prepaid card a currency, since all of them are Japanese', () => {
    for (const c of PREPAID_CARDS) expect(methodCountry(c.name)).toBe('JP')
  })

  it('never maps a method to a currency the app does not have', () => {
    for (const v of Object.values(METHOD_COUNTRY)) expect(['JP', 'IN']).toContain(v)
  })
})

// PaymentMethodGrid builds its options from this map, and EntryFlow advances on
// `opt.country`. Reproducing that one line here pins the behaviour the fix
// depends on without mounting the component.
describe('selecting a card overrides a stale country', () => {
  const select = (label, current) => methodCountry(label) || current

  it('replaces a leftover IN when a yen card is tapped', () => {
    expect(select('Edenred', 'IN')).toBe('JP')
    expect(select('Pasmo', 'IN')).toBe('JP')
    expect(select('nimoca', 'IN')).toBe('JP')
  })

  it('replaces a leftover JP when UPI is tapped', () => {
    expect(select('UPI', 'JP')).toBe('IN')
  })

  it('keeps whatever was chosen for cash', () => {
    expect(select('Cash', 'IN')).toBe('IN')
    expect(select('Cash', 'JP')).toBe('JP')
  })
})

describe('a card overrules a stored country, so old records self-heal', () => {
  // The udon, exactly as it sits in the database: saved as a rupee expense
  // because the previous entry was Indian and Edenred did not override it.
  const udon = {
    id: 'u1',
    amount: 900,
    paymentMethod: 'Edenred',
    country: 'IN',
    note: 'sukesan udon',
    date: new Date('2026-08-05'),
  }
  const lunch = {
    id: 'l1',
    amount: 500,
    paymentMethod: 'Edenred',
    country: 'JP',
    date: new Date('2026-08-06'),
  }
  const recharges = [{ id: 'r1', card: 'Edenred', amount: 10000, date: new Date('2026-07-16') }]

  // Edenred is yen. Full stop. The stored 'IN' is corrupt data, not a choice,
  // so the card spends it as the ¥900 it always was — no edit required.
  it('deducts the record the card actually paid for', () => {
    expect(cardBalance('Edenred', recharges, [udon, lunch])).toBe(10000 - 900 - 500)
  })

  it('reads it as yen everywhere, not just on the card', () => {
    expect(countryOf(udon)).toBe('JP')
    expect(countryOf(lunch)).toBe('JP')
  })

  it('gives the same answer once the stored country is corrected', () => {
    const fixed = { ...udon, country: 'JP' }
    expect(cardBalance('Edenred', recharges, [fixed, lunch])).toBe(
      cardBalance('Edenred', recharges, [udon, lunch])
    )
  })

  it('keeps rupee spending out of the yen total', () => {
    // A genuine rupee expense — no fixed-currency method involved.
    const upiBuy = { id: 'x', amount: 900, paymentMethod: 'UPI', country: 'IN' }
    expect(countryOf(upiBuy)).toBe('IN')
    // and UPI overrules a stray 'JP' the same way, in the other direction
    expect(countryOf({ ...upiBuy, country: 'JP' })).toBe('IN')
  })

  it('leaves cash and bank records to say their own currency', () => {
    expect(countryOf({ paymentMethod: 'Cash', country: 'IN' })).toBe('IN')
    expect(countryOf({ paymentMethod: 'ICICI', country: 'IN' })).toBe('IN')
    expect(countryOf({ paymentMethod: 'Cash' })).toBe('JP')
  })

  it('treats a card record with no country as yen', () => {
    expect(countryOf({ paymentMethod: 'Pasmo' })).toBe('JP')
  })

  it('does not touch a card the expense was not paid with', () => {
    expect(cardBalance('Pasmo', [], [udon])).toBe(0)
  })
})
