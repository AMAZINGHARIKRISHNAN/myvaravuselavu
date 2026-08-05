import { describe, it, expect } from 'vitest'
import { chartTheme, colorForKey, gradientId, donutSlices } from './chartTheme'
import { SKINS } from './skins'

const palette = ['#111111', '#222222', '#333333', '#444444']

describe('colorForKey', () => {
  // The whole point: 'Food' is the same colour in the ring, in the bar under
  // it, and next month when the data has changed shape entirely.
  it('gives a name the same colour every time', () => {
    expect(colorForKey('Food', palette)).toBe(colorForKey('Food', palette))
  })

  it('does not shift when the surrounding data changes', () => {
    const before = colorForKey('Rent', palette)
    colorForKey('Coffee', palette)
    colorForKey('Transport', palette)
    expect(colorForKey('Rent', palette)).toBe(before)
  })

  it('always lands inside the palette, whatever it is given', () => {
    for (const key of ['', 'x', 'a very long category name', '日本語', null, undefined]) {
      expect(palette).toContain(colorForKey(key, palette))
    }
  })
})

describe('gradientId', () => {
  it('is a valid, stable id derived from the colour', () => {
    expect(gradientId('#7C3AED')).toBe('g7c3aed')
    expect(gradientId('#7c3aed')).toBe(gradientId('#7C3AED'))
    expect(gradientId('#7c3aed')).toMatch(/^[A-Za-z][\w-]*$/) // usable in url(#…)
  })
})

describe('chartTheme', () => {
  it('serves every skin a complete theme', () => {
    for (const s of SKINS) {
      const t = chartTheme(s.key, true)
      expect(t.series.income).toMatch(/^#/)
      expect(t.categories.length).toBeGreaterThanOrEqual(6)
      expect(t.ringWidth).toBeGreaterThan(0)
      expect(t.grid).toMatch(/^#/)
    }
  })

  it('changes the data colours with the suit, not just the chrome', () => {
    const classic = chartTheme('classic', true)
    const neon = chartTheme('neon', true)
    expect(neon.categories).not.toEqual(classic.categories)
    expect(neon.gradients).toBe(true)
    expect(classic.gradients).toBe(false)
  })

  it('follows light and dark within a suit', () => {
    expect(chartTheme('neon', true).grid).not.toBe(chartTheme('neon', false).grid)
  })

  it('falls back to the default suit for an unknown key', () => {
    expect(chartTheme('mark-99', true).categories).toEqual(chartTheme('classic', true).categories)
  })
})

describe('donutSlices', () => {
  const data = [
    { name: 'Food', value: 40 },
    { name: 'Rent', value: 30 },
    { name: 'Fun', value: 20 },
    { name: 'Bills', value: 10 },
  ]

  it('sorts biggest first and works out each share', () => {
    const { slices, total } = donutSlices(data, { palette })
    expect(slices.map((s) => s.name)).toEqual(['Food', 'Rent', 'Fun', 'Bills'])
    expect(total).toBe(100)
    expect(slices[0].pct).toBeCloseTo(0.4)
  })

  // A 14-slice ring is a colour wheel, not a chart.
  it('rolls the tail into one Other slice', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `c${i}`, value: 10 - i }))
    const { slices } = donutSlices(many, { max: 3, palette })
    expect(slices).toHaveLength(4)
    expect(slices[3]).toMatchObject({ name: 'Other', rolled: 7 })
    expect(slices[3].value).toBe(7 + 6 + 5 + 4 + 3 + 2 + 1)
  })

  it('drops zero and negative rows rather than drawing invisible slices', () => {
    const { slices } = donutSlices([...data, { name: 'Zero', value: 0 }], { palette })
    expect(slices.some((s) => s.name === 'Zero')).toBe(false)
  })

  it('survives no data at all', () => {
    expect(donutSlices([], { palette })).toEqual({ slices: [], total: 0 })
  })

  it('gives every slice a colour from the palette', () => {
    for (const s of donutSlices(data, { palette }).slices) expect(palette).toContain(s.color)
  })
})
