import { describe, it, expect } from 'vitest'
import { buildInsights } from './insights'

const exp = (category, amount) => ({ category, amount })

describe('buildInsights', () => {
  it('returns no insights for empty data', () => {
    expect(
      buildInsights({ expenses: [], prevExpenses: [], savingsRate: NaN, prevSavingsRate: NaN })
    ).toEqual([])
  })

  it('reports the top spending category', () => {
    const insights = buildInsights({
      expenses: [exp('Food', 5000), exp('Coffee', 900)],
      prevExpenses: [],
      savingsRate: NaN,
      prevSavingsRate: NaN,
    })
    expect(insights[0].text).toContain('Food')
    expect(insights[0].text).toContain('top spend')
  })

  it('reports the biggest category change of 20% or more', () => {
    const insights = buildInsights({
      expenses: [exp('Transport', 3000)],
      prevExpenses: [exp('Transport', 2000)],
      savingsRate: NaN,
      prevSavingsRate: NaN,
    })
    const change = insights.find((i) => i.text.includes('vs last month'))
    expect(change.text).toContain('Transport is up 50%')
  })

  it('ignores category changes under 20%', () => {
    const insights = buildInsights({
      expenses: [exp('Food', 1100)],
      prevExpenses: [exp('Food', 1000)],
      savingsRate: NaN,
      prevSavingsRate: NaN,
    })
    expect(insights.find((i) => i.text.includes('vs last month'))).toBeUndefined()
  })

  it('reports savings rate movement of 3+ points', () => {
    const insights = buildInsights({
      expenses: [],
      prevExpenses: [],
      savingsRate: 0.3,
      prevSavingsRate: 0.2,
    })
    expect(insights[0].text).toContain('saving more')
  })

  it('reports the top store once it has repeat visits', () => {
    const insights = buildInsights({
      expenses: [
        { category: 'Food', amount: 900, store: 'Lawson' },
        { category: 'Food', amount: 600, store: 'lawson' },
      ],
      prevExpenses: [],
      savingsRate: NaN,
      prevSavingsRate: NaN,
    })
    const store = insights.find((i) => i.icon === '🏪')
    // The yen glyph varies by ICU build — assert on the parts that matter.
    expect(store.text).toContain('lawson took')
    expect(store.text).toContain('1,500')
    expect(store.text).toContain('over 2 visits')
  })

  it('stays quiet about a store visited only once', () => {
    const insights = buildInsights({
      expenses: [{ category: 'Food', amount: 900, store: 'Lawson' }],
      prevExpenses: [],
      savingsRate: NaN,
      prevSavingsRate: NaN,
    })
    expect(insights.find((i) => i.icon === '🏪')).toBeUndefined()
  })

  it('caps output at 3 insights', () => {
    const insights = buildInsights({
      expenses: [exp('Food', 5000), exp('Coffee', 4000)],
      prevExpenses: [exp('Food', 1000), exp('Coffee', 8000)],
      savingsRate: 0.1,
      prevSavingsRate: 0.5,
    })
    expect(insights.length).toBeLessThanOrEqual(3)
  })
})
