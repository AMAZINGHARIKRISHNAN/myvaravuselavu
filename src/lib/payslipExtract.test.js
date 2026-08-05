import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PAYSLIP_PROMPT, extractPayslip } from './payslipExtract'
import { setAiEnabled, resetRateGuard } from './ai'
import { ALLOWANCE_KEYS, DEDUCTION_KEYS } from './payslip'

let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key')
  resetRateGuard()
  setAiEnabled('payslips', true)
})

const reply = (payload) =>
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
        }),
    })
  )

const consistent = {
  period: '2026-07',
  gross: 291200,
  net: 225800,
  allowances: { base: 280000, overtime: 0, commute: 11200, housing: 0, other: 0 },
  deductions: { health: 16000, pension: 29000, employment: 1900, incomeTax: 6500, residentTax: 12000, other: 0 },
  workDays: 21,
  overtimeHours: 0,
}

describe('the prompt', () => {
  it('names every line the maths expects, so none can be silently dropped', () => {
    for (const k of [...ALLOWANCE_KEYS, ...DEDUCTION_KEYS]) {
      expect(PAYSLIP_PROMPT, k).toContain(`"${k}"`)
    }
  })

  it('carries the Japanese terms actually printed on a slip', () => {
    expect(PAYSLIP_PROMPT).toContain('総支給額')
    expect(PAYSLIP_PROMPT).toContain('差引支給額')
    expect(PAYSLIP_PROMPT).toContain('住民税')
  })

  // If the model "helpfully" fixes a line, the consistency check can no longer
  // tell us the read was wrong.
  it('forbids the model correcting the figures', () => {
    expect(PAYSLIP_PROMPT).toMatch(/Do not compute or correct/i)
    expect(PAYSLIP_PROMPT).toMatch(/Never guess/i)
  })
})

describe('extractPayslip', () => {
  it('returns a normalised slip that hangs together', async () => {
    reply(consistent)
    const { payslip, ok, problems } = await extractPayslip('data:image/jpeg;base64,AAA')
    expect(ok).toBe(true)
    expect(problems).toEqual([])
    expect(payslip.period).toBe('2026-07')
    expect(payslip.deductions.residentTax).toBe(12000)
  })

  // The whole point of the guard: a misread must surface, not save.
  it('flags a slip whose numbers contradict each other', async () => {
    reply({ ...consistent, net: 300000 })
    const { ok, problems } = await extractPayslip('data:image/jpeg;base64,AAA')
    expect(ok).toBe(false)
    expect(problems.join(' ')).toMatch(/net reads/)
  })

  it('coerces the formatted strings a model tends to return', async () => {
    reply({ ...consistent, gross: '¥291,200', net: '225,800円' })
    const { payslip, ok } = await extractPayslip('data:image/jpeg;base64,AAA')
    expect(payslip.gross).toBe(291200)
    expect(ok).toBe(true)
  })

  it('refuses when the payslip feature is off', async () => {
    setAiEnabled('payslips', false)
    reply(consistent)
    await expect(extractPayslip('data:image/jpeg;base64,AAA')).rejects.toThrow(/feature off/)
  })

  it('lets an offline failure through so the caller can fall back to typing', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(extractPayslip('data:image/jpeg;base64,AAA')).rejects.toThrow(/offline/)
  })
})
