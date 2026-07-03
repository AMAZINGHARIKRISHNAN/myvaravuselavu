const PIN_KEY = 'vs_pin_hash'
const UNLOCK_KEY = 'vs_unlocked'
const ATTEMPTS_KEY = 'vs_pin_attempts'
const LOCKOUT_KEY = 'vs_pin_lockout_until'

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 30_000

async function hashPin(pin) {
  const data = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function hasPin() {
  return Boolean(localStorage.getItem(PIN_KEY))
}

export async function setPin(pin) {
  localStorage.setItem(PIN_KEY, await hashPin(pin))
  resetAttempts()
  markUnlocked()
}

export function clearPin() {
  localStorage.removeItem(PIN_KEY)
  resetAttempts()
  sessionStorage.removeItem(UNLOCK_KEY)
}

export async function verifyPin(pin) {
  const stored = localStorage.getItem(PIN_KEY)
  return stored === (await hashPin(pin))
}

export function isUnlocked() {
  return sessionStorage.getItem(UNLOCK_KEY) === '1'
}

export function markUnlocked() {
  sessionStorage.setItem(UNLOCK_KEY, '1')
}

// Lockout after repeated wrong PIN entries, to slow down on-device brute-forcing.
export function getLockoutRemainingMs() {
  const until = parseInt(localStorage.getItem(LOCKOUT_KEY) || '0', 10)
  return Math.max(0, until - Date.now())
}

export function recordFailedAttempt() {
  const attempts = parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0', 10) + 1
  if (attempts >= MAX_ATTEMPTS) {
    localStorage.setItem(LOCKOUT_KEY, String(Date.now() + LOCKOUT_MS))
    localStorage.setItem(ATTEMPTS_KEY, '0')
  } else {
    localStorage.setItem(ATTEMPTS_KEY, String(attempts))
  }
  return MAX_ATTEMPTS - attempts
}

export function resetAttempts() {
  localStorage.removeItem(ATTEMPTS_KEY)
  localStorage.removeItem(LOCKOUT_KEY)
}
