import { describe, it, expect } from 'vitest'
import { parseExpenseText } from './parseExpenseText'

describe('parseExpenseText', () => {
  it('parses a simple "category amount" phrase', () => {
    const result = parseExpenseText('coffee 450')
    expect(result.amount).toBe(450)
    expect(result.category).toBe('Coffee')
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
    expect(result.category).toBe('Food')
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
    expect(result.note).toBe('lunch at Saizeriya')
  })
})
