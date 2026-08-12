import { describe, it, expect } from 'vitest'
import { parseExpenseText } from './parseExpenseText'

describe('parseExpenseText', () => {
  it('parses a simple "category amount" phrase', () => {
    const result = parseExpenseText('coffee 450')
    expect(result.amount).toBe(450)
    expect(result.category).toBe('Snacks')
    expect(result.note).toBe('coffee')
  })

  it('parses amounts with digit-group commas', () => {
    const result = parseExpenseText('lunch 1,200')
    expect(result.amount).toBe(1200)
    expect(result.category).toBe('Food')
  })

  it('parses decimal amounts', () => {
    expect(parseExpenseText('taxi 12.50').amount).toBe(12.5)
  })

  it('prefers standalone numbers over digits glued to words', () => {
    const result = parseExpenseText('7-eleven snack 450')
    expect(result.amount).toBe(450)
    // 'snack' used to be a Food keyword; it has its own category now.
    expect(result.category).toBe('Snacks')
  })

  it('falls back to the first number when none stand alone', () => {
    expect(parseExpenseText('450yen coffee').amount).toBe(450)
  })

  it('returns null amount when there is no number', () => {
    expect(parseExpenseText('coffee with friends').amount).toBeNull()
  })

  it('detects payment methods', () => {
    expect(parseExpenseText('groceries 3000 upi').paymentMethod).toBe('UPI')
    expect(parseExpenseText('lunch 900 cash').paymentMethod).toBe('Cash')
    expect(parseExpenseText('dinner 1500 edenred').paymentMethod).toBe('Edenred')
    expect(parseExpenseText('dinner 1500').paymentMethod).toBeNull()
  })

  it('defaults to Other for unknown categories', () => {
    expect(parseExpenseText('mystery thing 800').category).toBe('Other')
  })

  it('strips the amount and noise words from the note', () => {
    const result = parseExpenseText('lunch at Saizeriya 1200 debit card')
    expect(result.amount).toBe(1200)
    expect(result.note).toBe('lunch')
  })

  it('pulls the store out of "at <shop>"', () => {
    const result = parseExpenseText('lunch at Saizeriya 1200 debit card')
    expect(result.store).toBe('Saizeriya')
  })

  it('pulls the store out of "from <shop>" and after the amount', () => {
    expect(parseExpenseText('milk 250 from Family Mart').store).toBe('Family Mart')
  })

  it('drops payment words trailing the store name', () => {
    const result = parseExpenseText('coffee at Starbucks cash 450')
    expect(result.store).toBe('Starbucks')
    expect(result.paymentMethod).toBe('Cash')
    expect(result.note).toBe('coffee')
  })

  it('leaves the store empty when no shop is named', () => {
    expect(parseExpenseText('coffee 450').store).toBe('')
  })
})

// ---- Journeys ---------------------------------------------------------------
// Transport is a route, not a purchase. Before this the store regex swallowed
// the whole sentence and produced a "shop" called
// "aeon nogata to nogata train station which costed around".
describe('transport routes', () => {
  it('splits the real sentence into two places and no shop', () => {
    const r = parseExpenseText(
      'today i traveled in bus from aeon nogata to nogata train station which costed around 270yen i paid with pasmo'
    )
    expect(r.category).toBe('Transport')
    expect(r.amount).toBe(270)
    expect(r.fromPlace).toBe('Aeon Nogata')
    expect(r.toPlace).toBe('Nogata Train Station')
    expect(r.paymentMethod).toBe('Pasmo')
    expect(r.store).toBe('')
  })

  it('reads the short forms', () => {
    expect(parseExpenseText('bus 270 from nogata to kokura')).toMatchObject({
      fromPlace: 'Nogata',
      toPlace: 'Kokura',
    })
    expect(parseExpenseText('train 500 nogata → hakata')).toMatchObject({
      fromPlace: 'Nogata',
      toPlace: 'Hakata',
    })
  })

  it('takes a destination alone when no origin was said', () => {
    const r = parseExpenseText('bus 270 to kokura')
    expect(r.fromPlace).toBe('')
    expect(r.toPlace).toBe('Kokura')
  })

  // The other categories must be completely unaffected.
  it('leaves a shop purchase as a shop purchase', () => {
    const r = parseExpenseText('lunch at saizeriya 1200')
    expect(r.store).toBe('saizeriya')
    expect(r.fromPlace).toBe('')
    expect(r.toPlace).toBe('')
  })

  it('does not invent a route from a non-transport sentence containing "to"', () => {
    const r = parseExpenseText('gave 3000 to kenji')
    expect(r.fromPlace).toBe('')
    expect(r.toPlace).toBe('')
  })
})
