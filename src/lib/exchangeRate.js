const CACHE_KEY = 'vs_jpy_inr_rate'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// Free, keyless endpoint — fine for a personal client-side app on the Spark plan.
const RATE_URL = 'https://open.er-api.com/v6/latest/JPY'

export async function fetchLiveJpyInrRate() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.rate
    }
  } catch {
    // ignore malformed cache
  }

  const res = await fetch(RATE_URL)
  if (!res.ok) throw new Error('Rate fetch failed')
  const json = await res.json()
  const rate = json?.rates?.INR
  if (!rate) throw new Error('INR rate missing from response')

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rate, fetchedAt: Date.now() }))
  } catch {
    // Storage full or blocked (private mode) — we already have the rate, so
    // failing to cache it must not fail the whole call.
  }
  return rate
}
