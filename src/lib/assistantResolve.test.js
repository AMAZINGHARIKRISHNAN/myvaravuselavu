import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { askAssistant, buildResolvePrompt, resolveQuestion, validateResolution } from './assistantResolve'
import { QUERY_IDS, queryMenu, runQuery } from './assistantQueries'
import { setAiEnabled, resetRateGuard } from './ai'

const NOW = new Date(2026, 7, 15, 12)
const at = (day) => new Date(2026, 7, day, 12)

// A month of real records, so the answers below are computed, not fixtures.
const CTX = {
  settings: { budgets: { Food: 40000 }, salaryDay: 25 },
  expenses: [
    { id: 'e1', amount: 30000, category: 'Food', date: at(3) },
    { id: 'e2', amount: 12000, category: 'Food', date: at(9) },
    { id: 'e3', amount: 8000, category: 'Transport', date: at(10) },
    { id: 'e4', amount: 5000, category: 'Food', country: 'IN', date: at(11) },
    { id: 'old', amount: 99999, category: 'Food', date: new Date(2026, 6, 3, 12) }, // last month
  ],
  transfers: [{ id: 't1', amountSent: 50000, date: at(6) }],
  balances: [
    { label: 'MUFJ', country: 'JP', balance: 289200 },
    { label: 'ICICI', country: 'IN', balance: 71100 },
  ],
  cardBalances: { Pasmo: 310, Edenred: 8761 },
  safe: { perDay: 4200, daysLeft: 17 },
}

let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubEnv('VITE_GEMINI_API_KEY', 'k')
  resetRateGuard()
  setAiEnabled('assistant', true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// Replies the model gives, one per call.
const stubReplies = (...payloads) => {
  let i = 0
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        { content: { parts: [{ text: JSON.stringify(payloads[Math.min(i++, payloads.length - 1)]) }] } },
      ],
    }),
  }))
}

describe('the model is shown ids, never data', () => {
  it('offers the known queries and no figures', () => {
    const prompt = buildResolvePrompt('how did food do?', queryMenu())
    expect(prompt).toContain('spent.category')
    expect(prompt).toMatch(/never state a number/i)
    expect(prompt).toMatch(/classifier/i)
    // Nothing from the ledger is in the classification prompt.
    expect(prompt).not.toMatch(/30000|289200|MUFJ/)
  })
})

describe('a reply is a classification or it is nothing', () => {
  it('accepts a clean mapping', () => {
    expect(validateResolution({ resolvedTo: 'spent.category', args: { category: 'Food' } })).toEqual({
      resolvedTo: 'spent.category',
      args: { category: 'Food' },
    })
  })

  it('accepts an honest "nothing fits"', () => {
    expect(validateResolution({ resolvedTo: null })).toEqual({ resolvedTo: null, args: {} })
  })

  // THE REJECTION THAT MATTERS: a model answering directly has produced a
  // figure from its own head, and its head has never seen this ledger.
  it('REJECTS a reply that states a number itself', () => {
    expect(validateResolution({ resolvedTo: 'spent.category', args: {}, answer: 'You spent 42,000' })).toBe(null)
    expect(validateResolution({ resolvedTo: 'spent.month', amount: 42000 })).toBe(null)
    expect(validateResolution({ resolvedTo: 'spent.month', args: {}, total: 42000 })).toBe(null)
    expect(validateResolution({ speech: 'You spent 42,000 on food.' })).toBe(null)
  })

  it('rejects an id it invented', () => {
    expect(validateResolution({ resolvedTo: 'spent.everything' })).toBe(null)
    expect(validateResolution({ resolvedTo: 42 })).toBe(null)
  })

  it('rejects malformed shapes', () => {
    expect(validateResolution(null)).toBe(null)
    expect(validateResolution([])).toBe(null)
    expect(validateResolution('spent.month')).toBe(null)
    expect(validateResolution({ resolvedTo: 'spent.month', args: 'Food' })).toBe(null)
  })

  it('strips arguments that are not short values', () => {
    const out = validateResolution({
      resolvedTo: 'spent.category',
      args: { category: 'Food', payload: { nested: true }, huge: 'x'.repeat(200) },
    })
    expect(out.args).toEqual({ category: 'Food' })
  })
})

describe('a fuzzy question is answered from real data', () => {
  it('maps a vague food question to the category query and computes it', async () => {
    stubReplies({ resolvedTo: 'spent.category', args: { category: 'Food' } })
    const out = await resolveQuestion("how'd food do this month?", CTX, { now: NOW })
    expect(out.ok).toBe(true)
    expect(out.resolvedTo).toBe('spent.category')
    // 30,000 + 12,000 yen. The rupee row and last month's are excluded.
    expect(out.answer.amount).toBe(42000)
    expect(out.answer.text).toContain('42,000')
  })

  it('takes the figure from local data, never from the model', async () => {
    stubReplies({ resolvedTo: 'spent.month' })
    const out = await resolveQuestion('what have I got through this month?', CTX, { now: NOW })
    expect(out.answer.amount).toBe(50000) // 30,000 + 12,000 + 8,000 yen
  })

  it('answers a card question from the balance the app computed', async () => {
    stubReplies({ resolvedTo: 'card.balance', args: { card: 'edenred' } })
    const out = await resolveQuestion('anything left on the meal card?', CTX, { now: NOW })
    expect(out.answer.amount).toBe(8761)
  })

  it('keeps the currencies apart', async () => {
    stubReplies({ resolvedTo: 'spent.rupees' })
    const out = await resolveQuestion('how much in rupees?', CTX, { now: NOW })
    expect(out.answer.amount).toBe(5000)
    expect(out.answer.currency).toBe('IN')
  })
})

describe('a question it cannot compute is declined', () => {
  it('declines when the model maps it to nothing', async () => {
    stubReplies({ resolvedTo: null })
    const out = await askAssistant('what will the yen do next year?', CTX, 'jarvis', { now: NOW })
    expect(out.intent).toBe('unknown')
    expect(out.resolved).toBe('unmapped')
    expect(out.speech).toMatch(/can't work that one out/i)
    // No figure anywhere in the reply.
    expect(out.speech).not.toMatch(/\d/)
  })

  it('declines when it maps to something this data cannot answer', async () => {
    stubReplies({ resolvedTo: 'budget.status', args: { category: 'Fun' } })
    const out = await askAssistant('how is the fun budget?', CTX, 'jarvis', { now: NOW })
    expect(out.intent).toBe('unknown')
    expect(out.resolved).toBe('nodata')
    expect(out.speech).not.toMatch(/\d/)
  })

  it('declines when the model tried to answer directly', async () => {
    stubReplies({ resolvedTo: 'spent.month', args: {}, answer: 'You spent 1,000,000.' })
    const out = await askAssistant('how much this month?', CTX, 'jarvis', { now: NOW })
    expect(out.resolved).toBe('rejected')
    expect(out.speech).not.toMatch(/1,000,000/)
  })

  it('declines when the feature is off, without calling anything', async () => {
    setAiEnabled('assistant', false)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const out = await resolveQuestion('anything', CTX, { now: NOW })
    expect(out).toEqual({ ok: false, reason: 'unavailable' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('declines rather than throwing when the call fails', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    await expect(resolveQuestion('anything', CTX, { now: NOW })).resolves.toMatchObject({ ok: false })
  })
})

describe('the spoken number is the computed number', () => {
  // The polish path costs a SECOND call, and the rate guard debounces
  // back-to-back ones to catch double taps. A real user's two calls are
  // separated by a network round trip; the clock is advanced here to match.
  const letTimePass = () => {
    let t = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => (t += 5000))
  }

  it('keeps the wording only when every digit survived', async () => {
    letTimePass()
    stubReplies(
      { resolvedTo: 'spent.category', args: { category: 'Food' } },
      { lines: ['Food stands at 42,000 this month, sir.'] }
    )
    const out = await askAssistant('how did food do?', CTX, 'jarvis', { now: NOW, polish: true })
    expect(out.intent).toBe('resolved')
    expect(out.source).toBe('ai')
    expect(out.speech).toContain('42,000')
  })

  it('falls back to the local sentence when the model changed the figure', async () => {
    letTimePass()
    stubReplies(
      { resolvedTo: 'spent.category', args: { category: 'Food' } },
      { lines: ['Food is about 40,000 this month, sir.'] }
    )
    const out = await askAssistant('how did food do?', CTX, 'jarvis', { now: NOW, polish: true })
    expect(out.source).toBe('local')
    expect(out.speech).toContain('42,000')
    expect(out.speech).not.toContain('40,000')
  })
})

describe('the query registry', () => {
  it('every id computes or returns null — never throws', () => {
    for (const id of QUERY_IDS) {
      expect(() => runQuery(id, {}, CTX, NOW)).not.toThrow()
      expect(() => runQuery(id, {}, {}, NOW)).not.toThrow()
    }
  })

  it('refuses a category the app does not have', () => {
    expect(runQuery('spent.category', { category: 'Groceries' }, CTX, NOW)).toBe(null)
  })

  it('refuses an unknown id', () => {
    expect(runQuery('spent.everything', {}, CTX, NOW)).toBe(null)
  })

  it('every answer carries a finite figure and a sentence', () => {
    const out = runQuery('spent.month', {}, CTX, NOW)
    expect(Number.isFinite(out.amount)).toBe(true)
    expect(typeof out.text).toBe('string')
  })
})


describe('by default the sentence never leaves the device', () => {
  it('voices the answer locally, in the suit’s register', async () => {
    stubReplies({ resolvedTo: 'spent.category', args: { category: 'Food' } })
    const out = await askAssistant('how did food do?', CTX, 'jarvis', { now: NOW })
    expect(out.source).toBe('local')
    expect(out.speech).toContain('42,000')
    expect(out.speech).toMatch(/sir/i) // personaSpeech applied
  })

  it('makes exactly one model call — to classify, not to answer', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ resolvedTo: 'spent.month' }) }] } }],
        }),
      }
    })
    await askAssistant('how much this month?', CTX, 'jarvis', { now: NOW })
    expect(calls).toBe(1)
  })
})
