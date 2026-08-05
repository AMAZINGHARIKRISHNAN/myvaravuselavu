import { describe, it, expect } from 'vitest'
import { budgetRows, budgetAlert } from './budget'
import { formatJPY } from './format'

const budgets = { Food: 30000, Transport: 10000, Fun: 5000 }

describe('budgetRows', () => {
  it('computes remaining and state, worst-first', () => {
    const rows = budgetRows(budgets, { Food: 31000, Transport: 8500, Fun: 1000 })
    expect(rows.map((r) => r.category)).toEqual(['Food', 'Transport', 'Fun']) // by ratio desc
    expect(rows[0]).toMatchObject({ state: 'over', remaining: -1000 })
    expect(rows[1].state).toBe('near') // 85%
    expect(rows[2].state).toBe('ok') // 20%
  })

  it('ignores categories with no budget set', () => {
    expect(budgetRows({ Food: 0, Fun: 5000 }, {})).toHaveLength(1)
  })
})

describe('budgetAlert', () => {
  it('leads with an over-budget category', () => {
    const a = budgetAlert(budgets, { Food: 33000, Transport: 9000 })
    expect(a.level).toBe('over')
    expect(a.text).toContain('Food is over budget by')
    expect(a.text).toContain(formatJPY(3000))
  })

  it('counts extra over-budget categories', () => {
    const a = budgetAlert(budgets, { Food: 33000, Transport: 12000 })
    expect(a.count).toBe(2)
    expect(a.text).toContain('+1 more')
  })

  it('warns about a near-budget category when none are over', () => {
    const a = budgetAlert(budgets, { Food: 27000 }) // 90%
    expect(a.level).toBe('near')
    expect(a.text).toContain('left of')
  })

  it('is null when everything is comfortable', () => {
    expect(budgetAlert(budgets, { Food: 1000, Transport: 500 })).toBe(null)
    expect(budgetAlert({}, {})).toBe(null)
  })
})
