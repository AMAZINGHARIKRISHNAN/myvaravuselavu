import { describe, it, expect } from 'vitest'
import { pressKey, displayAmount } from './amountInput'

// Typing a sequence of keys, the way a thumb would.
const type = (keys, start = '0') =>
  keys.reduce((v, k) => {
    const next = pressKey(v, k)
    return next === null ? v : next
  }, start)

describe('pressKey', () => {
  it('replaces the leading zero rather than appending to it', () => {
    expect(pressKey('0', '5')).toBe('5')
    expect(type(['1', '2', '0', '0'])).toBe('1200')
  })

  it('types paise', () => {
    expect(type(['4', '9', '.', '9', '9'])).toBe('49.99')
  })

  it('opens a bare point as 0. so the figure always reads', () => {
    expect(pressKey('0', '.')).toBe('0.')
    expect(pressKey('', '.')).toBe('0.')
    expect(type(['.', '5', '0'])).toBe('0.50')
  })

  it('allows only one decimal point', () => {
    expect(pressKey('12.5', '.')).toBe(null)
    expect(type(['1', '.', '5', '.', '2'])).toBe('1.52')
  })

  it('stops at two decimal places', () => {
    expect(pressKey('1.99', '9')).toBe(null)
    expect(type(['1', '.', '2', '3', '4', '5'])).toBe('1.23')
  })

  it("won't let '00' push past two decimals either", () => {
    expect(pressKey('1.', '00')).toBe('1.00')
    expect(pressKey('1.5', '00')).toBe(null)
  })

  it('ignores 00 as the first keystroke, so an amount never opens as 00', () => {
    expect(pressKey('', '00')).toBe(null)
    expect(pressKey('0', '00')).toBe(null)
  })

  it('keeps 00 useful for the round amounts it exists for', () => {
    expect(type(['1', '5', '00'])).toBe('1500')
  })

  it('respects the length cap', () => {
    expect(pressKey('123456789012', '3')).toBe(null)
  })

  it('parses to the number that was actually typed', () => {
    expect(parseFloat(type(['2', '4', '9', '.', '5']))).toBe(249.5)
    expect(parseFloat(type(['0', '.', '0', '1']))).toBe(0.01)
  })
})

describe('displayAmount', () => {
  it('groups thousands', () => {
    expect(displayAmount('1500')).toBe('1,500')
    expect(displayAmount('1234567')).toBe('1,234,567')
  })

  it('keeps a trailing zero that was typed', () => {
    // Number('12.50') is 12.5 — watching the zero disappear mid-type is what
    // this exists to prevent.
    expect(displayAmount('12.50')).toBe('12.50')
    expect(displayAmount('12.00')).toBe('12.00')
  })

  it('keeps the point visible the moment it is pressed', () => {
    expect(displayAmount('12.')).toBe('12.')
  })

  it('groups the whole part while decimals are being typed', () => {
    expect(displayAmount('1234.5')).toBe('1,234.5')
  })

  it('shows 0 for nothing', () => {
    expect(displayAmount('')).toBe('0')
    expect(displayAmount('0')).toBe('0')
    expect(displayAmount(undefined)).toBe('0')
  })
})
