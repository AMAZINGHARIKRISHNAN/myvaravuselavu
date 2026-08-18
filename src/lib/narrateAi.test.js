import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { acceptable, buildNarrationPrompt, narrateWithAi } from './narrateAi'
import { narrateAll } from './narrate'
import { personaOf } from './persona'
import { setAiEnabled, resetRateGuard } from './ai'

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
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const runway = { kind: 'salaryRunway', currency: 'JP', daysToSalary: 10, perDay: 4000, projectedSpend: 40000, available: 289200, shortfall: 25000, willRunOut: true }
const budget = { kind: 'budgetBurn', currency: 'JP', category: 'Food', cap: 40000, spent: 20000, remaining: 20000, exceeded: false, crossesOnDay: 22, withinMonth: true }
const SIGNALS = [runway, budget]

describe('the model is handed figures, never records', () => {
  it('sends only allow-listed fields', () => {
    const context = { currency: 'JPY', signals: [{ kind: 'salaryRunway', shortfall: 25000 }] }
    const prompt = buildNarrationPrompt(context, personaOf('jarvis'), narrateAll(SIGNALS, 'jarvis'))
    expect(prompt).toContain('salaryRunway')
    expect(prompt).toContain('25000')
  })

  it('tells the model it must not calculate', () => {
    const prompt = buildNarrationPrompt({}, personaOf('jarvis'), narrateAll(SIGNALS, 'jarvis'))
    expect(prompt).toMatch(/never calculate/i)
    expect(prompt).toMatch(/never invent, adjust or round/i)
    expect(prompt).toMatch(/never give advice/i)
  })
})

describe('a reply is only accepted if the numbers survived', () => {
  const local = narrateAll(SIGNALS, 'jarvis')

  it('accepts a rephrasing that keeps every digit', () => {
    const same = local.map((l) => `Sir. ${l.text}`)
    expect(acceptable({ lines: same }, local)).toEqual(same)
  })

  // The failure this whole layer exists to prevent.
  it('REJECTS a reply that changed a number', () => {
    const rounded = local.map((l) => l.text.replace(/[\d,]+/, '99999'))
    expect(acceptable({ lines: rounded }, local)).toBe(null)
  })

  it('rejects the wrong shape, the wrong length, and empty strings', () => {
    expect(acceptable({ lines: 'nope' }, local)).toBe(null)
    expect(acceptable({}, local)).toBe(null)
    expect(acceptable(null, local)).toBe(null)
    expect(acceptable({ lines: [local[0].text] }, local)).toBe(null)
    expect(acceptable({ lines: ['', ''] }, local)).toBe(null)
  })
})

describe('narrateWithAi — the model never decides whether there is a line', () => {
  it('uses local templates when the feature is off', async () => {
    setAiEnabled('insights', false)
    const out = await narrateWithAi(SIGNALS, 'jarvis')
    expect(out.source).toBe('local')
    expect(out.lines).toEqual(narrateAll(SIGNALS, 'jarvis'))
  })

  it('falls back to local when the call throws', async () => {
    setAiEnabled('insights', true)
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    const out = await narrateWithAi(SIGNALS, 'jarvis')
    expect(out.source).toBe('local')
    expect(out.lines[0].text).toBe(narrateAll(SIGNALS, 'jarvis')[0].text)
  })

  it('falls back when the model changed a figure', async () => {
    setAiEnabled('insights', true)
    const local = narrateAll(SIGNALS, 'jarvis')
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ lines: local.map(() => 'About ¥1 short.') }) }] } }],
      }),
    }))
    const out = await narrateWithAi(SIGNALS, 'jarvis')
    expect(out.source).toBe('local')
  })

  it('uses the polished lines when they keep the numbers', async () => {
    setAiEnabled('insights', true)
    const local = narrateAll(SIGNALS, 'jarvis')
    const polished = local.map((l) => `${l.text} Noted.`)
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ lines: polished }) }] } }],
      }),
    }))
    const out = await narrateWithAi(SIGNALS, 'jarvis')
    expect(out.source).toBe('ai')
    expect(out.lines.map((l) => l.text)).toEqual(polished)
  })

  // Nothing to say is nothing to send.
  it('never calls the model when no signal is narratable', async () => {
    setAiEnabled('insights', true)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const out = await narrateWithAi([{ kind: 'salaryRunway', available: null }], 'jarvis')
    expect(out.source).toBe('none')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never rejects — a sentence failing is not an error', async () => {
    setAiEnabled('insights', true)
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }))
    await expect(narrateWithAi(SIGNALS, 'jarvis')).resolves.toBeDefined()
  })
})
