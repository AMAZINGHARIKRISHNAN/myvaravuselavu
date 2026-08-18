import { describe, it, expect } from 'vitest'
import { expenseFromCsvRow, parseCsv } from './csv'
import { currencyMismatches } from './currencyAudit'

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    const rows = parseCsv('Date,Amount,Note\n2026-01-05,450,coffee\n2026-01-06,1200,lunch')
    expect(rows).toEqual([
      { Date: '2026-01-05', Amount: '450', Note: 'coffee' },
      { Date: '2026-01-06', Amount: '1200', Note: 'lunch' },
    ])
  })

  it('handles quoted fields containing commas and newlines', () => {
    const rows = parseCsv('Note,Amount\n"lunch, with team",1200\n"line1\nline2",300')
    expect(rows[0].Note).toBe('lunch, with team')
    expect(rows[1].Note).toBe('line1\nline2')
  })

  it('unescapes doubled quotes', () => {
    const rows = parseCsv('Note\n"say ""hi"""')
    expect(rows[0].Note).toBe('say "hi"')
  })

  it('handles CRLF line endings', () => {
    const rows = parseCsv('A,B\r\n1,2\r\n3,4\r\n')
    expect(rows).toEqual([
      { A: '1', B: '2' },
      { A: '3', B: '4' },
    ])
  })

  it('fills missing trailing fields with empty strings', () => {
    const rows = parseCsv('A,B,C\n1,2')
    expect(rows[0]).toEqual({ A: '1', B: '2', C: '' })
  })

  it('returns empty array for empty input', () => {
    expect(parseCsv('')).toEqual([])
  })
})

// Import was the last way to create a currency mismatch. Every entry form
// derives currency from the payment method; a CSV was trusted to say it itself.
describe('expenseFromCsvRow — the method decides the currency', () => {
  const ACCOUNTS = [
    { id: '1', label: 'MUFJ', country: 'JP' },
    { id: '2', label: 'ICICI', country: 'IN' },
  ]
  const row = (extra) => ({ Amount: '900', Date: '2026-08-15', ...extra })

  // The exact row that used to produce a mismatch.
  it('overrules Country=IN on a yen account', () => {
    const r = expenseFromCsvRow(row({ Country: 'IN', 'Payment Method': 'MUFJ' }), ACCOUNTS)
    expect(r.country).toBe('JP')
    expect(r.paymentMethod).toBe('MUFJ')
  })

  it('overrules Country=JP on a rupee account', () => {
    expect(expenseFromCsvRow(row({ Country: 'JP', 'Payment Method': 'ICICI' }), ACCOUNTS).country).toBe('IN')
  })

  it('overrules the column for a fixed-currency card', () => {
    expect(expenseFromCsvRow(row({ Country: 'IN', 'Payment Method': 'Edenred' }), ACCOUNTS).country).toBe('JP')
    expect(expenseFromCsvRow(row({ Country: 'JP', 'Payment Method': 'UPI' }), ACCOUNTS).country).toBe('IN')
  })

  // Cash is the one method that genuinely holds both, so here the column is the
  // only thing that knows — and is therefore trusted.
  it('falls back to the Country column for cash', () => {
    expect(expenseFromCsvRow(row({ Country: 'IN', 'Payment Method': 'Cash' }), ACCOUNTS).country).toBe('IN')
    expect(expenseFromCsvRow(row({ Country: 'JP', 'Payment Method': 'Cash' }), ACCOUNTS).country).toBe('JP')
  })

  it('falls back for a method the app no longer knows', () => {
    expect(expenseFromCsvRow(row({ Country: 'IN', 'Payment Method': 'PayPay' }), ACCOUNTS).country).toBe('IN')
  })

  it('defaults to yen when the column is absent too', () => {
    expect(expenseFromCsvRow(row({ 'Payment Method': 'Cash' }), ACCOUNTS).country).toBe('JP')
  })

  it('defaults the method to Cash when the column is missing', () => {
    expect(expenseFromCsvRow(row({}), ACCOUNTS).paymentMethod).toBe('Cash')
  })

  it('skips a row with no amount or no date, as before', () => {
    expect(expenseFromCsvRow({ Date: '2026-08-15' }, ACCOUNTS)).toBe(null)
    expect(expenseFromCsvRow({ Amount: '900' }, ACCOUNTS)).toBe(null)
    expect(expenseFromCsvRow({ Amount: 'abc', Date: '2026-08-15' }, ACCOUNTS)).toBe(null)
  })

  it('carries the rest of the row through unchanged', () => {
    const r = expenseFromCsvRow(
      row({ Category: 'Food', Store: 'Lawson', From: 'A', To: 'B', Note: 'lunch', 'Payment Method': 'Cash' }),
      ACCOUNTS
    )
    expect(r).toMatchObject({ category: 'Food', fromPlace: 'A', toPlace: 'B', note: 'lunch', amount: 900 })
  })

  // A record whose country disagrees with its account is exactly what
  // currencyAudit flags — import must not be able to produce one.
  it('cannot produce a record the detector would flag', () => {
    for (const method of ['MUFJ', 'ICICI', 'Edenred', 'UPI']) {
      for (const column of ['JP', 'IN']) {
        const r = expenseFromCsvRow(row({ Country: column, 'Payment Method': method }), ACCOUNTS)
        expect(currencyMismatches({ expenses: [{ ...r, id: 'x' }] }, ACCOUNTS), `${method}/${column}`).toEqual([])
      }
    }
  })
})
