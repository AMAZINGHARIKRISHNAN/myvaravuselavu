import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  AI_FEATURES,
  aiEnabled,
  setAiEnabled,
  isAvailable,
  isOnline,
  rateCheck,
  resetRateGuard,
  minimalContext,
  stripJsonFences,
  dataUrlToInline,
  toneFor,
  TONES,
  HOUSE_RULES,
  ask,
  hasApiKey,
  readCandidateText,
} from './ai'

let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  // navigator is a getter-only global in modern Node — stubGlobal, not assign.
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key-not-a-real-one')
  resetRateGuard()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// Stubs global fetch with a generateContent-shaped reply, and records the
// requests so the wire format can be asserted.
function stubFetch(text, { status = 200, body, reject = false } = {}) {
  const calls = []
  vi.stubGlobal('fetch', (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    if (reject) return Promise.reject(new TypeError('Failed to fetch'))
    const payload =
      body !== undefined ? body : { candidates: [{ content: { parts: [{ text }] } }] }
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(payload),
    })
  })
  return calls
}

describe('feature flags', () => {
  it('is off for every feature by default', () => {
    for (const f of AI_FEATURES) expect(aiEnabled(f.key)).toBe(false)
  })

  it('turns features on independently', () => {
    setAiEnabled('receipts', true)
    expect(aiEnabled('receipts')).toBe(true)
    expect(aiEnabled('assistant')).toBe(false)
  })

  it('refuses a feature name it does not know', () => {
    setAiEnabled('mind-reading', true)
    expect(aiEnabled('mind-reading')).toBe(false)
  })

  it('survives storage being unavailable', () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(aiEnabled('assistant')).toBe(false)
    expect(() => setAiEnabled('assistant', true)).not.toThrow()
  })
})

describe('isAvailable', () => {
  it('is false while the feature is off, even online', () => {
    expect(isAvailable('assistant')).toBe(false)
  })

  it('is true once on, online and under the rate guard', () => {
    setAiEnabled('assistant', true)
    expect(isAvailable('assistant')).toBe(true)
  })

  // The single most important line in the file: offline means local.
  it('is false offline', () => {
    setAiEnabled('assistant', true)
    vi.stubGlobal('navigator', { onLine: false })
    expect(isAvailable('assistant')).toBe(false)
  })

  it('treats an environment without navigator as online', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isOnline()).toBe(true)
  })
})

describe('rate guard', () => {
  it('allows the first call', () => {
    expect(rateCheck().ok).toBe(true)
  })

  it('debounces a double-tap', async () => {
    setAiEnabled('assistant', true)
    stubFetch('ok')
    await ask('one', { feature: 'assistant' })
    await expect(ask('two', { feature: 'assistant' })).rejects.toThrow(/debounce/)
  })

  it('stops a loop at the per-minute ceiling', async () => {
    setAiEnabled('assistant', true)
    stubFetch('ok')
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    for (let i = 0; i < 15; i++) {
      now += 1000 // past the debounce, inside the minute
      await ask(`q${i}`, { feature: 'assistant' })
    }
    now += 1000
    await expect(ask('one too many', { feature: 'assistant' })).rejects.toThrow(/rpm/)
    Date.now.mockRestore()
  })

  it('lets the window slide open again after a minute', () => {
    resetRateGuard()
    expect(rateCheck(0).ok).toBe(true)
    expect(rateCheck(120_000).ok).toBe(true)
  })

  it('refuses once the day’s cap is spent', () => {
    const date = new Date().toISOString().slice(0, 10)
    store.set('vs_ai_day', JSON.stringify({ date, count: 1500 }))
    expect(rateCheck().reason).toBe('rpd')
  })

  it('starts the daily count fresh on a new date', () => {
    store.set('vs_ai_day', JSON.stringify({ date: '2020-01-01', count: 9999 }))
    expect(rateCheck().ok).toBe(true)
  })
})

describe('minimalContext — the privacy allow-list', () => {
  // The test that matters: anything not explicitly allowed must not survive.
  it('drops free text rather than forwarding it', () => {
    const context = minimalContext({
      income: 442000,
      note: 'lunch with Kenji about the divorce',
      friend: 'Kenji',
      groupName: 'Kitakyushu flat',
      store: 'Lawson Kokura',
      pin: '4821',
      accountNumber: '1234567',
    })
    const serialized = JSON.stringify(context)
    expect(serialized).not.toMatch(/Kenji|divorce|Kitakyushu|Lawson|4821|1234567/)
    expect(context.income).toBe(442000)
  })

  it('passes through only the computed figures it knows', () => {
    expect(
      minimalContext({ income: 100.7, expenses: 50.2, savingsRate: 0.4123, currency: 'JPY' })
    ).toEqual({ currency: 'JPY', income: 101, expenses: 50, savingsRate: 0.41 })
  })

  it('keeps the two currencies apart rather than defaulting INR to yen', () => {
    expect(minimalContext({ currency: 'INR' }).currency).toBe('INR')
    expect(minimalContext({ currency: 'nonsense' }).currency).toBe('JPY')
  })

  it('carries category totals but truncates any overlong key', () => {
    const context = minimalContext({
      byCategory: { Food: 12000, Coffee: 3000, Empty: 0, ['x'.repeat(80)]: 5 },
    })
    expect(context.byCategory.Food).toBe(12000)
    expect(context.byCategory.Empty).toBeUndefined()
    expect(Object.keys(context.byCategory).every((k) => k.length <= 24)).toBe(true)
  })

  it('reduces forecast signals to shapes, never raw records', () => {
    const context = minimalContext({
      signals: [
        { kind: 'budgetBurn', category: 'Food', day: 22, amount: 40000, raw: { note: 'secret' } },
        { garbage: true },
      ],
    })
    expect(context.signals).toEqual([{ kind: 'budgetBurn', category: 'Food', amount: 40000, day: 22 }])
  })

  it('emits no empty keys for a scope it was given nothing for', () => {
    expect(minimalContext()).toEqual({ currency: 'JPY' })
  })
})

describe('stripJsonFences', () => {
  it('unwraps a fenced block', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('leaves bare JSON alone', () => {
    expect(stripJsonFences('{"a":1}')).toBe('{"a":1}')
  })

  it('digs the object out of a chatty answer', () => {
    expect(stripJsonFences('Sure! Here you go: {"a":1} — hope that helps')).toBe('{"a":1}')
  })

  it('handles an array too', () => {
    expect(stripJsonFences('here: [1,2]')).toBe('[1,2]')
  })
})

describe('dataUrlToInline', () => {
  it('splits a compressed receipt into the inlineData part', () => {
    expect(dataUrlToInline('data:image/jpeg;base64,AAAA')).toEqual({
      inlineData: { mimeType: 'image/jpeg', data: 'AAAA' },
    })
  })

  it('throws rather than sending garbage', () => {
    expect(() => dataUrlToInline('not a url')).toThrow()
    expect(() => dataUrlToInline('')).toThrow()
    expect(() => dataUrlToInline('data:image/png,notbase64')).toThrow()
  })
})

describe('tone', () => {
  it('gives each identity its own voice and falls back safely', () => {
    expect(new Set(Object.values(TONES)).size).toBe(3)
    expect(toneFor('friday')).toBe(TONES.friday)
    expect(toneFor('classic')).toBe(TONES.jarvis)
  })

  it('forbids advice and arithmetic in the house rules', () => {
    expect(HOUSE_RULES).toMatch(/never do arithmetic/i)
    expect(HOUSE_RULES).toMatch(/not advice|never recommend/i)
  })
})

describe('ask', () => {
  it('POSTs the documented generateContent shape with the key in a header', async () => {
    setAiEnabled('assistant', true)
    const calls = stubFetch('All systems nominal.')

    await expect(ask('status?', { feature: 'assistant' })).resolves.toBe('All systems nominal.')
    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent'
    )
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers['x-goog-api-key']).toBe('test-key-not-a-real-one')
    expect(calls[0].body).toEqual({ contents: [{ parts: [{ text: 'status?' }] }] })
  })

  // The key belongs in a header, not a query string, so it stays out of logs.
  it('never puts the key in the URL', async () => {
    setAiEnabled('assistant', true)
    const calls = stubFetch('ok')
    await ask('x', { feature: 'assistant' })
    expect(calls[0].url).not.toMatch(/key=/)
  })

  it('appends an image as a second inlineData part', async () => {
    setAiEnabled('receipts', true)
    const calls = stubFetch('{}')

    await ask('read this', { feature: 'receipts', image: 'data:image/jpeg;base64,ZZZ' })
    expect(calls[0].body.contents[0].parts).toEqual([
      { text: 'read this' },
      { inlineData: { mimeType: 'image/jpeg', data: 'ZZZ' } },
    ])
  })

  it('parses JSON when asked to', async () => {
    setAiEnabled('receipts', true)
    stubFetch(['```json', '{"total":1240}', '```'].join('\n'))
    await expect(ask('x', { feature: 'receipts', json: true })).resolves.toEqual({ total: 1240 })
  })

  it('joins text split across several parts', () => {
    expect(
      readCandidateText({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] })
    ).toBe('ab')
    expect(readCandidateText({})).toBe('')
    expect(readCandidateText(null)).toBe('')
  })

  // Every one of these is a case where the caller must fall back to local.
  it('throws when no key is configured, without calling out', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', '')
    setAiEnabled('assistant', true)
    const calls = stubFetch('ok')
    await expect(ask('x', { feature: 'assistant' })).rejects.toThrow(/no API key/)
    expect(calls).toHaveLength(0)
    expect(hasApiKey()).toBe(false)
  })

  it('throws when the feature is off', async () => {
    await expect(ask('x', { feature: 'assistant' })).rejects.toThrow(/feature off/)
  })

  it('throws when offline', async () => {
    setAiEnabled('assistant', true)
    vi.stubGlobal('navigator', { onLine: false })
    await expect(ask('x', { feature: 'assistant' })).rejects.toThrow(/offline/)
  })

  // The two errors the user will actually hit while setting the key up, so
  // Google's own wording is surfaced rather than paraphrased.
  it('surfaces a bad-key message verbatim', async () => {
    setAiEnabled('assistant', true)
    stubFetch(null, { status: 400, body: { error: { message: 'API key not valid.' } } })
    await expect(ask('x', { feature: 'assistant' })).rejects.toThrow(/API key not valid/)
  })

  it('surfaces a referrer-blocked message verbatim', async () => {
    setAiEnabled('assistant', true)
    stubFetch(null, {
      status: 403,
      body: { error: { message: 'Requests from referer https://evil.example/ are blocked.' } },
    })
    await expect(ask('x', { feature: 'assistant' })).rejects.toThrow(/are blocked/)
  })

  it('falls back to the status code when the error body is not JSON', async () => {
    setAiEnabled('assistant', true)
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('nope')) })
    )
    await expect(ask('x', { feature: 'assistant' })).rejects.toThrow(/HTTP 500/)
  })

  it('throws on a network failure rather than hanging', async () => {
    setAiEnabled('assistant', true)
    stubFetch(null, { reject: true })
    await expect(ask('x', { feature: 'assistant' })).rejects.toThrow(/network request failed/)
  })

  // A refused prompt comes back 200 with no candidate at all.
  it('throws when the prompt was safety-blocked', async () => {
    setAiEnabled('assistant', true)
    stubFetch(null, { body: { promptFeedback: { blockReason: 'SAFETY' } } })
    await expect(ask('x', { feature: 'assistant' })).rejects.toThrow(/blocked \(SAFETY\)/)
  })

  it('throws rather than returning unparseable JSON', async () => {
    setAiEnabled('assistant', true)
    stubFetch('I am afraid I cannot do that')
    await expect(ask('x', { feature: 'assistant', json: true })).rejects.toThrow(/not JSON/)
  })

  it('throws on an empty response instead of returning nothing', async () => {
    setAiEnabled('assistant', true)
    stubFetch('')
    await expect(ask('x', { feature: 'assistant' })).rejects.toThrow(/empty/)
  })

  // A failing call still spends quota, so it must still count.
  it('counts a failed call against the rate guard', async () => {
    setAiEnabled('assistant', true)
    stubFetch(null, { status: 500, body: {} })
    await expect(ask('x', { feature: 'assistant' })).rejects.toThrow()
    await expect(ask('y', { feature: 'assistant' })).rejects.toThrow(/debounce/)
  })
})
