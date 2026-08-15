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

// A feature that is actually built. The gate refuses anything with
// `ready: false`, so a test asserting the gate must use one that passes it.
const BUILT = AI_FEATURES.find((f) => f.ready).key
const OTHER_BUILT = AI_FEATURES.filter((f) => f.ready)[1]?.key

describe('feature flags', () => {
  // On unless turned off: one user, his own key, his own data. Making him find
  // a settings screen before a feature works protects nobody.
  it('is on by default for every feature that is built', () => {
    for (const f of AI_FEATURES.filter((x) => x.ready)) expect(aiEnabled(f.key)).toBe(true)
  })

  // `ready: false` means the code is not there. Defaulting those on would
  // enable something that cannot work.
  it('is off for a feature that is not built yet', () => {
    for (const f of AI_FEATURES.filter((x) => !x.ready)) expect(aiEnabled(f.key)).toBe(false)
  })

  it('stays off once turned off', () => {
    const built = AI_FEATURES.find((f) => f.ready).key
    setAiEnabled(built, false)
    expect(aiEnabled(built)).toBe(false)
    setAiEnabled(built, true)
    expect(aiEnabled(built)).toBe(true)
  })

  it('turns features on independently', () => {
    setAiEnabled(BUILT, false)
    expect(aiEnabled(BUILT)).toBe(false)
    expect(aiEnabled(OTHER_BUILT ?? BUILT)).toBe(OTHER_BUILT ? true : false)
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
    // On is the useful answer when the switch cannot be read; the rate guard
    // still applies in memory.
    expect(aiEnabled(BUILT)).toBe(true)
    expect(() => setAiEnabled(BUILT, true)).not.toThrow()
  })
})

describe('isAvailable', () => {
  it('is false once the feature is turned off, even online', () => {
    setAiEnabled(BUILT, false)
    expect(isAvailable(BUILT)).toBe(false)
  })

  it('is true once on, online and under the rate guard', () => {
    setAiEnabled(BUILT, true)
    expect(isAvailable(BUILT)).toBe(true)
  })

  // The single most important line in the file: offline means local.
  it('is false offline', () => {
    setAiEnabled(BUILT, true)
    vi.stubGlobal('navigator', { onLine: false })
    expect(isAvailable(BUILT)).toBe(false)
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
    setAiEnabled(BUILT, true)
    stubFetch('ok')
    await ask('one', { feature: BUILT })
    await expect(ask('two', { feature: BUILT })).rejects.toThrow(/debounce/)
  })

  it('stops a loop at the per-minute ceiling', async () => {
    setAiEnabled(BUILT, true)
    stubFetch('ok')
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    for (let i = 0; i < 15; i++) {
      now += 1000 // past the debounce, inside the minute
      await ask(`q${i}`, { feature: BUILT })
    }
    now += 1000
    await expect(ask('one too many', { feature: BUILT })).rejects.toThrow(/rpm/)
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

describe('ask', () => {
  it('POSTs the documented generateContent shape with the key in a header', async () => {
    setAiEnabled(BUILT, true)
    const calls = stubFetch('All systems nominal.')

    await expect(ask('status?', { feature: BUILT })).resolves.toBe('All systems nominal.')
    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent'
    )
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers['x-goog-api-key']).toBe('test-key-not-a-real-one')
    expect(calls[0].body.contents).toEqual([{ parts: [{ text: 'status?' }] }])
    // Deterministic by default: the same sentence must produce the same
    // records twice, and creativity is not a virtue when reading spending.
    expect(calls[0].body.generationConfig.temperature).toBe(0)
    // JSON mode is asked for only when JSON is wanted.
    expect(calls[0].body.generationConfig.responseMimeType).toBeUndefined()
  })

  // The key belongs in a header, not a query string, so it stays out of logs.
  it('never puts the key in the URL', async () => {
    setAiEnabled(BUILT, true)
    const calls = stubFetch('ok')
    await ask('x', { feature: BUILT })
    expect(calls[0].url).not.toMatch(/key=/)
  })

  it('appends an image as a second inlineData part', async () => {
    const calls = stubFetch('{}')

    await ask('read this', { feature: BUILT, image: 'data:image/jpeg;base64,ZZZ' })
    expect(calls[0].body.contents[0].parts).toEqual([
      { text: 'read this' },
      { inlineData: { mimeType: 'image/jpeg', data: 'ZZZ' } },
    ])
  })

  it('parses JSON when asked to', async () => {
    stubFetch(['```json', '{"total":1240}', '```'].join('\n'))
    await expect(ask('x', { feature: BUILT, json: true })).resolves.toEqual({ total: 1240 })
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
    setAiEnabled(BUILT, true)
    const calls = stubFetch('ok')
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/no API key/)
    expect(calls).toHaveLength(0)
    expect(hasApiKey()).toBe(false)
  })

  it('throws when the feature has been turned off', async () => {
    setAiEnabled(BUILT, false)
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/feature off/)
  })

  // A feature whose code is not written must refuse regardless of any switch.
  it('throws for a feature that is not built', async () => {
    const unbuilt = AI_FEATURES.find((f) => !f.ready)
    if (!unbuilt) return
    setAiEnabled(unbuilt.key, true)
    await expect(ask('x', { feature: unbuilt.key })).rejects.toThrow(/feature off/)
  })

  it('throws when offline', async () => {
    setAiEnabled(BUILT, true)
    vi.stubGlobal('navigator', { onLine: false })
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/offline/)
  })

  // The two errors the user will actually hit while setting the key up, so
  // Google's own wording is surfaced rather than paraphrased.
  it('surfaces a bad-key message verbatim', async () => {
    setAiEnabled(BUILT, true)
    stubFetch(null, { status: 400, body: { error: { message: 'API key not valid.' } } })
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/API key not valid/)
  })

  it('surfaces a referrer-blocked message verbatim', async () => {
    setAiEnabled(BUILT, true)
    stubFetch(null, {
      status: 403,
      body: { error: { message: 'Requests from referer https://evil.example/ are blocked.' } },
    })
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/are blocked/)
  })

  it('falls back to the status code when the error body is not JSON', async () => {
    setAiEnabled(BUILT, true)
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('nope')) })
    )
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/HTTP 500/)
  })

  it('throws on a network failure rather than hanging', async () => {
    setAiEnabled(BUILT, true)
    stubFetch(null, { reject: true })
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/network request failed/)
  })

  // A refused prompt comes back 200 with no candidate at all.
  it('throws when the prompt was safety-blocked', async () => {
    setAiEnabled(BUILT, true)
    stubFetch(null, { body: { promptFeedback: { blockReason: 'SAFETY' } } })
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/blocked \(SAFETY\)/)
  })

  it('throws rather than returning unparseable JSON', async () => {
    setAiEnabled(BUILT, true)
    stubFetch('I am afraid I cannot do that')
    await expect(ask('x', { feature: BUILT, json: true })).rejects.toThrow(/not JSON/)
  })

  it('throws on an empty response instead of returning nothing', async () => {
    setAiEnabled(BUILT, true)
    stubFetch('')
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/empty/)
  })

  // A failing call still spends quota, so it must still count.
  it('counts a failed call against the rate guard', async () => {
    setAiEnabled(BUILT, true)
    stubFetch(null, { status: 500, body: {} })
    await expect(ask('x', { feature: BUILT })).rejects.toThrow()
    await expect(ask('y', { feature: BUILT })).rejects.toThrow(/debounce/)
  })
})

// The feature failed on its first real use with "I could not read that one".
// The model had simply been busy — a 503 — and there was no retry, so a
// transient shrug became a dead end.
describe('a busy model is not a failure', () => {
  const okBody = {
    candidates: [{ content: { parts: [{ text: 'fine' }] } }],
  }

  it('retries a 503 and succeeds', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      if (calls < 3) return { ok: false, status: 503, json: async () => ({ error: { message: 'busy' } }) }
      return { ok: true, json: async () => okBody }
    })
    await expect(ask('x', { feature: BUILT })).resolves.toBe('fine')
    expect(calls).toBe(3)
  })

  it('retries a 429 as well', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      if (calls < 2) return { ok: false, status: 429, json: async () => ({ error: { message: 'slow down' } }) }
      return { ok: true, json: async () => okBody }
    })
    await expect(ask('x', { feature: BUILT })).resolves.toBe('fine')
  })

  it('gives up honestly rather than retrying forever', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return { ok: false, status: 503, json: async () => ({ error: { message: 'still busy' } }) }
    })
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/still busy/)
    expect(calls).toBe(3) // the first, then two retries
  })

  // A bad key is not going to fix itself, and retrying it wastes quota.
  it('does not retry a refusal', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return { ok: false, status: 403, json: async () => ({ error: { message: 'API key not valid' } }) }
    })
    await expect(ask('x', { feature: BUILT })).rejects.toThrow(/API key not valid/)
    expect(calls).toBe(1)
  })

  it('asks for JSON at the protocol level when JSON is wanted', async () => {
    let sent
    vi.stubGlobal('fetch', async (_url, init) => {
      sent = JSON.parse(init.body)
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }) }
    })
    await ask('x', { feature: BUILT, json: true })
    expect(sent.generationConfig.responseMimeType).toBe('application/json')
    expect(sent.generationConfig.temperature).toBe(0)
  })
})
