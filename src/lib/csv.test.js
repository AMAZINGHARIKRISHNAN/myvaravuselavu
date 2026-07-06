import { describe, it, expect } from 'vitest'
import { parseCsv } from './csv'

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
