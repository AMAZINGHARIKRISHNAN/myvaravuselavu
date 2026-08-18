import { describe, it, expect } from 'vitest'
import { capGroups, ROW_LIMIT } from './listWindow'

const group = (key, n) => ({ key, records: Array.from({ length: n }, (_, i) => ({ id: `${key}-${i}` })) })
const countRows = (groups) => groups.reduce((s, g) => s + g.records.length, 0)

describe('capGroups', () => {
  // The instruction that matters most: a short list must behave exactly as it
  // did before. Below the threshold this returns the very same array.
  it('leaves a short list completely untouched', () => {
    const groups = [group('a', 10), group('b', 5)]
    const out = capGroups(groups, 300)
    expect(out.groups).toBe(groups) // same reference, not a copy
    expect(out.capped).toBe(false)
    expect(out.hidden).toBe(0)
  })

  it('leaves a list sitting exactly on the threshold alone', () => {
    const groups = [group('a', 300)]
    expect(capGroups(groups, 300).capped).toBe(false)
  })

  it('caps a long list at the limit and says how many are hidden', () => {
    const groups = [group('a', 200), group('b', 200), group('c', 200)]
    const out = capGroups(groups, 300)
    expect(countRows(out.groups)).toBe(300)
    expect(out.hidden).toBe(300)
    expect(out.capped).toBe(true)
  })

  // Days are kept whole where they fit, so the cut does not land in the middle
  // of a day for no reason.
  it('keeps whole days and trims only the one that crosses the line', () => {
    const groups = [group('a', 100), group('b', 100), group('c', 100), group('d', 100)]
    const out = capGroups(groups, 250)
    expect(out.groups.map((g) => g.records.length)).toEqual([100, 100, 50])
    expect(out.hidden).toBe(150)
  })

  it('never returns more groups than it was given', () => {
    const groups = [group('a', 500)]
    const out = capGroups(groups, 300)
    expect(out.groups).toHaveLength(1)
    expect(countRows(out.groups)).toBe(300)
  })

  it('preserves everything else about a trimmed group', () => {
    const groups = [{ key: 'a', label: 'Mon', totalLabel: '¥1,000', records: [{ id: 1 }, { id: 2 }] }]
    const out = capGroups(groups, 1)
    expect(out.groups[0]).toMatchObject({ key: 'a', label: 'Mon', totalLabel: '¥1,000' })
    expect(out.groups[0].records).toHaveLength(1)
  })

  it('copes with empty and malformed input', () => {
    expect(capGroups([], 300)).toEqual({ groups: [], hidden: 0, capped: false })
    expect(capGroups()).toEqual({ groups: [], hidden: 0, capped: false })
    expect(capGroups([{ key: 'a' }], 300).capped).toBe(false) // no records array
  })

  it('has a sane default threshold', () => {
    expect(ROW_LIMIT).toBeGreaterThan(100)
    expect(capGroups([group('a', 10)]).capped).toBe(false)
  })
})
