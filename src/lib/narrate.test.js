import { describe, it, expect } from 'vitest'
import { headlineFor, isNarratable, narrateAll, narrateSignal } from './narrate'

const SKINS = ['jarvis', 'friday', 'edith']

// Signals exactly as forecast.js produces them.
const monthEnd = (over = {}) => ({
  kind: 'monthEnd', currency: 'JP', spent: 60000, upcoming: 3126, projectedSpend: 127126,
  projectedLeftover: 122874, perDaySoFar: 4000, daysLeft: 17, ...over,
})
const budgetBurn = (over = {}) => ({
  kind: 'budgetBurn', currency: 'JP', category: 'Food', cap: 40000, spent: 20000,
  remaining: 20000, exceeded: false, crossesOnDay: 22, withinMonth: true, ...over,
})
const anomaly = (over = {}) => ({
  kind: 'categoryAnomaly', currency: 'JP', category: 'Food', amount: 42000,
  average: 25000, delta: 17000, ratio: 0.68, direction: 'up', ...over,
})
const pass = (over = {}) => ({
  kind: 'passOutlook', currency: 'JP', tripsToBreakEven: 5, brokenEven: false,
  expired: false, cost: 20000, ...over,
})
const runway = (over = {}) => ({
  kind: 'salaryRunway', currency: 'JP', daysToSalary: 10, perDay: 4000,
  projectedSpend: 40000, available: 289200, shortfall: 0, willRunOut: false, ...over,
})

describe('every signal has a line in every voice', () => {
  const all = [monthEnd(), budgetBurn(), anomaly(), pass(), runway()]
  for (const skin of SKINS) {
    for (const signal of all) {
      it(`${skin} · ${signal.kind}`, () => {
        const text = narrateSignal(signal, skin)
        expect(typeof text).toBe('string')
        expect(text.length).toBeGreaterThan(10)
      })
    }
  }

  // Changing suit must never change what is true.
  it('quotes the same figures under every identity', () => {
    for (const signal of [monthEnd(), runway({ shortfall: 25000 })]) {
      const digits = SKINS.map((skin) => narrateSignal(signal, skin).replace(/[^\d]/g, ''))
      expect(new Set(digits).size).toBe(1)
    }
  })

  it('says something different in each voice', () => {
    const lines = SKINS.map((skin) => narrateSignal(runway({ shortfall: 25000 }), skin))
    expect(new Set(lines).size).toBe(3)
  })
})

describe('framing — estimates, never instructions', () => {
  const everything = [
    monthEnd(), monthEnd({ projectedLeftover: null }),
    budgetBurn(), budgetBurn({ exceeded: true, remaining: -2000 }),
    anomaly(), anomaly({ direction: 'down', ratio: -0.5 }),
    pass(), pass({ brokenEven: true, tripsToBreakEven: 0 }),
    runway(), runway({ shortfall: 25000 }),
  ]
  const lines = SKINS.flatMap((skin) => everything.map((s) => narrateSignal(s, skin)).filter(Boolean))

  it('never tells the user what to do', () => {
    for (const line of lines) {
      expect(line, line).not.toMatch(/\byou should\b|\bmove money\b|\bconsider \b|\bwe recommend\b|\bcut back\b/i)
    }
  })

  it('never states the future as fact', () => {
    for (const line of lines) {
      expect(line, line).not.toMatch(/\byou will\b|\bwill be\b|\bguaranteed\b/i)
    }
  })

  it('speaks in projections', () => {
    const projected = lines.filter((l) => /project|on track|at (this|the present|current) (rate|pace|burn)|pace|rate/i.test(l))
    expect(projected.length).toBeGreaterThan(SKINS.length)
  })

  it('never mixes the two currencies in one sentence', () => {
    for (const line of lines) {
      expect(line.includes('¥') && line.includes('₹'), line).toBe(false)
    }
  })

  it('formats rupee signals in rupees', () => {
    const line = narrateSignal(monthEnd({ currency: 'IN', projectedLeftover: 4200 }), 'edith')
    expect(line).toContain('₹')
    expect(line).not.toContain('¥')
  })
})

describe('a signal with nothing to say is not narrated', () => {
  it('skips a runway with no balance to judge against', () => {
    expect(isNarratable(runway({ available: null }))).toBe(false)
    expect(narrateSignal(runway({ available: null }), 'jarvis')).toBe(null)
  })

  it('skips a budget the pace will never reach — that is the good case', () => {
    expect(isNarratable(budgetBurn({ withinMonth: false, crossesOnDay: 80 }))).toBe(false)
  })

  it('still speaks about a budget already blown', () => {
    expect(isNarratable(budgetBurn({ exceeded: true, withinMonth: false, crossesOnDay: null }))).toBe(true)
  })

  it('skips a pass with no break-even, or an expired one', () => {
    expect(isNarratable(pass({ tripsToBreakEven: null }))).toBe(false)
    expect(isNarratable(pass({ expired: true }))).toBe(false)
  })

  it('skips an empty month', () => {
    expect(isNarratable(monthEnd({ projectedSpend: 0, projectedLeftover: null }))).toBe(false)
  })

  it('never says the word unknown', () => {
    const lines = SKINS.map((s) => narrateSignal(runway({ available: null }), s))
    expect(lines.every((l) => l === null)).toBe(true)
  })

  it('refuses a malformed signal instead of throwing', () => {
    expect(narrateSignal(null, 'jarvis')).toBe(null)
    expect(narrateSignal({ kind: 'nonsense' }, 'jarvis')).toBe(null)
    expect(narrateSignal({ kind: 'budgetBurn', exceeded: true }, 'jarvis')).not.toBe(undefined)
  })
})

describe('narrateAll and the headline', () => {
  const signals = [anomaly(), pass(), runway({ shortfall: 25000 }), budgetBurn(), monthEnd()]

  it('leads with what matters most, not engine order', () => {
    expect(narrateAll(signals, 'jarvis', { limit: 5 })[0].kind).toBe('salaryRunway')
  })

  it('caps how much it says at once', () => {
    expect(narrateAll(signals, 'jarvis')).toHaveLength(3)
  })

  it('drops the signals that had nothing to say', () => {
    const out = narrateAll([runway({ available: null }), anomaly()], 'jarvis')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('categoryAnomaly')
  })

  it('gives the HUD one line, or null when there is nothing', () => {
    expect(typeof headlineFor(signals, 'friday')).toBe('string')
    expect(headlineFor([], 'friday')).toBe(null)
    expect(headlineFor([runway({ available: null })], 'friday')).toBe(null)
  })

  it('falls back to the steward voice for an unknown skin', () => {
    expect(narrateSignal(runway(), 'classic')).toBe(narrateSignal(runway(), 'jarvis'))
  })
})
