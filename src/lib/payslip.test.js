import { describe, it, expect } from 'vitest'
import {
  payslipFileKind,
  MAX_PDF_BYTES,
  normalizePeriod,
  normalizePayslip,
  totalAllowances,
  totalDeductions,
  takeHomeRate,
  checkConsistency,
  comparePayslips,
  detectSteps,
  deductionTrends,
  commuteGap,
  baseline,
  DEDUCTION_KEYS,
} from './payslip'

// A consistent slip: allowances add to gross, gross − deductions = net.
const slip = (period, over = {}) => {
  const allowances = { base: 280000, overtime: 0, commute: 11200, housing: 0, other: 0, ...over.allowances }
  const deductions = {
    health: 16000, pension: 29000, employment: 1900,
    incomeTax: 6500, residentTax: 12000, other: 0,
    ...over.deductions,
  }
  const gross = Object.values(allowances).reduce((s, v) => s + v, 0)
  const net = gross - Object.values(deductions).reduce((s, v) => s + v, 0)
  return { period, gross, net, allowances, deductions, workDays: 21, overtimeHours: 0 }
}

describe('normalizePeriod', () => {
  it('reads the shapes a slip or a model produces', () => {
    expect(normalizePeriod('2026-07')).toBe('2026-07')
    expect(normalizePeriod('2026/7')).toBe('2026-07')
    expect(normalizePeriod('2026年7月')).toBe('2026-07')
    expect(normalizePeriod('July 2026')).toBe('')
  })

  it('rejects an impossible month rather than guessing', () => {
    expect(normalizePeriod('2026-13')).toBe('')
    expect(normalizePeriod('')).toBe('')
    expect(normalizePeriod(null)).toBe('')
  })
})

describe('normalizePayslip', () => {
  it('coerces the strings a model hands back', () => {
    const p = normalizePayslip({
      period: '2026年7月',
      gross: '¥291,200',
      net: '225,800円',
      allowances: { base: '280000', commute: '11,200' },
      deductions: { health: 16000 },
    })
    expect(p.period).toBe('2026-07')
    expect(p.gross).toBe(291200)
    expect(p.net).toBe(225800)
    expect(p.allowances.commute).toBe(11200)
  })

  it('fills every line so two months are always comparable', () => {
    const p = normalizePayslip({})
    for (const k of DEDUCTION_KEYS) expect(p.deductions[k]).toBe(0)
  })

  // A zero gross would poison every trend built on top of it.
  it('falls back to the sum of the lines when a total is missing', () => {
    const p = normalizePayslip({
      allowances: { base: 200000, commute: 10000 },
      deductions: { health: 15000 },
    })
    expect(p.gross).toBe(210000)
    expect(p.net).toBe(195000)
  })

  it('survives complete rubbish without throwing', () => {
    expect(() => normalizePayslip(null)).not.toThrow()
    expect(normalizePayslip({ gross: 'abc' }).gross).toBe(0)
  })
})

describe('totals', () => {
  it('adds the two sides up', () => {
    const p = slip('2026-07')
    expect(totalAllowances(p)).toBe(291200)
    expect(totalDeductions(p)).toBe(65400)
    expect(takeHomeRate(p)).toBeCloseTo(225800 / 291200, 4)
  })

  it('does not divide by a zero gross', () => {
    expect(takeHomeRate({ gross: 0, net: 0 })).toBeNaN()
  })
})

// The guard that stops a misread number being saved.
describe('checkConsistency', () => {
  it('passes a slip that adds up', () => {
    expect(checkConsistency(slip('2026-07')).ok).toBe(true)
  })

  it('catches a misread net', () => {
    const bad = { ...slip('2026-07'), net: 999999 }
    const result = checkConsistency(bad)
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/net reads/)
  })

  it('catches payment lines that do not add to gross', () => {
    const bad = slip('2026-07')
    bad.allowances.base = 100000 // lines no longer sum to the printed gross
    expect(checkConsistency(bad).ok).toBe(false)
  })

  it('insists on a period — an undated slip cannot be compared', () => {
    expect(checkConsistency({ ...slip('2026-07'), period: '' }).ok).toBe(false)
  })

  it('allows a yen of rounding', () => {
    const p = slip('2026-07')
    expect(checkConsistency({ ...p, net: p.net - 1 }).ok).toBe(true)
  })
})

describe('comparePayslips', () => {
  const months = [slip('2026-05'), slip('2026-06', { deductions: { residentTax: 24000 } }), slip('2026-07', { deductions: { residentTax: 24000 } })]

  it('sorts by period regardless of upload order', () => {
    const out = comparePayslips([months[2], months[0], months[1]])
    expect(out.map((m) => m.period)).toEqual(['2026-05', '2026-06', '2026-07'])
  })

  it('reports the first month with no deltas rather than inventing them', () => {
    const first = comparePayslips(months)[0]
    expect(first.netDelta).toBe(0)
    expect(first.grossDelta).toBe(0)
  })

  it('shows the month-on-month movement per line', () => {
    const june = comparePayslips(months)[1]
    expect(june.lines.residentTax.delta).toBe(12000)
    expect(june.netDelta).toBe(-12000)
  })
})

// The June resident-tax rise, found without knowing anything about the
// Japanese tax calendar: a big change that the following months keep.
describe('detectSteps', () => {
  const history = [
    slip('2026-04'),
    slip('2026-05'),
    slip('2026-06', { deductions: { residentTax: 24000 } }),
    slip('2026-07', { deductions: { residentTax: 24000 } }),
  ]

  it('finds the step and what it costs over a year', () => {
    const steps = detectSteps(history)
    const resident = steps.find((s) => s.key === 'residentTax')
    expect(resident.period).toBe('2026-06')
    expect(resident.from).toBe(12000)
    expect(resident.to).toBe(24000)
    expect(resident.annualImpact).toBe(144000)
  })

  // A one-off is not a new rate.
  it('ignores a spike that does not hold', () => {
    const blip = [
      slip('2026-04'),
      slip('2026-05', { deductions: { other: 30000 } }),
      slip('2026-06'),
    ]
    expect(detectSteps(blip).some((s) => s.key === 'other')).toBe(false)
  })

  it('marks a step with no month after it as provisional', () => {
    const steps = detectSteps(history.slice(0, 3))
    expect(steps.find((s) => s.key === 'residentTax').provisional).toBe(true)
  })

  it('ignores small wobble', () => {
    const noise = [slip('2026-04'), slip('2026-05', { deductions: { incomeTax: 6600 } })]
    expect(detectSteps(noise)).toHaveLength(0)
  })

  it('says nothing about a single month', () => {
    expect(detectSteps([slip('2026-07')])).toEqual([])
    expect(detectSteps([])).toEqual([])
  })
})

describe('deductionTrends', () => {
  it('ranks by what is costing most now, with the change across the range', () => {
    const rows = deductionTrends([slip('2026-04'), slip('2026-07', { deductions: { residentTax: 24000 } })])
    expect(rows[0].key).toBe('pension')
    const resident = rows.find((r) => r.key === 'residentTax')
    expect(resident.change).toBe(12000)
  })

  it('leaves out lines that were never charged', () => {
    const rows = deductionTrends([slip('2026-07')])
    expect(rows.some((r) => r.key === 'other')).toBe(false)
  })

  it('survives an empty history', () => {
    expect(deductionTrends([])).toEqual([])
  })
})

// The figure no other app could produce: the allowance against the real cost.
describe('commuteGap', () => {
  it('shows the allowance covering the real cost', () => {
    expect(commuteGap(slip('2026-07'), 8400)).toEqual({
      allowance: 11200,
      actual: 8400,
      gap: 2800,
      coversIt: true,
    })
  })

  it('shows a shortfall as a negative gap', () => {
    expect(commuteGap(slip('2026-07'), 14000).gap).toBe(-2800)
    expect(commuteGap(slip('2026-07'), 14000).coversIt).toBe(false)
  })

  it('says nothing when there is no commuting allowance', () => {
    expect(commuteGap(slip('2026-07', { allowances: { commute: 0 } }), 8400)).toBeNull()
  })
})

describe('baseline', () => {
  it('averages the recent months', () => {
    const b = baseline([slip('2026-05'), slip('2026-06'), slip('2026-07')], { months: 3 })
    expect(b.months).toBe(3)
    expect(b.gross).toBe(291200)
  })

  // Otherwise a month is judged against a baseline that includes itself.
  it('excludes the month being judged', () => {
    const history = [slip('2026-05'), slip('2026-06'), slip('2026-07', { allowances: { overtime: 90000 } })]
    const b = baseline(history, { months: 3, excludePeriod: '2026-07' })
    expect(b.months).toBe(2)
    expect(b.gross).toBe(291200)
  })

  it('returns nothing rather than dividing by zero', () => {
    expect(baseline([])).toBeNull()
  })
})

describe('payslipFileKind', () => {
  const file = (type, name, size = 1000) => ({ type, name, size })

  it('passes a PDF straight through — it is text, not pixels', () => {
    expect(payslipFileKind(file('application/pdf', 'july.pdf'))).toBe('pdf')
  })

  // Some browsers hand over an empty type for a file picked from Files.
  it('falls back to the extension when the browser gives no type', () => {
    expect(payslipFileKind(file('', 'july.pdf'))).toBe('pdf')
  })

  it('sends a photograph down the compression path', () => {
    expect(payslipFileKind(file('image/jpeg', 'IMG_1234.JPG'))).toBe('image')
  })

  // A huge PDF is a scan; base64 inflates it by a third and the request fails.
  it('refuses a PDF too big to inline', () => {
    expect(payslipFileKind(file('application/pdf', 'scan.pdf', MAX_PDF_BYTES + 1))).toBe('pdf-too-big')
  })

  it('rejects anything else rather than sending it and failing', () => {
    expect(payslipFileKind(file('text/csv', 'pay.csv'))).toBe('unsupported')
    expect(payslipFileKind(null)).toBe('unsupported')
  })
})
