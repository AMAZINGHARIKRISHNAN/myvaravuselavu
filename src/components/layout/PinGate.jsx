import { useEffect, useState } from 'react'
import {
  hasPin,
  isUnlocked,
  verifyPin,
  markUnlocked,
  getLockoutRemainingMs,
  recordFailedAttempt,
  resetAttempts,
} from '../../lib/appLock'

export default function PinGate({ children }) {
  const [locked, setLocked] = useState(false)
  const [checked, setChecked] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [lockoutMs, setLockoutMs] = useState(0)

  useEffect(() => {
    setLocked(hasPin() && !isUnlocked())
    setLockoutMs(getLockoutRemainingMs())
    setChecked(true)
  }, [])

  useEffect(() => {
    if (!locked) return
    const id = setInterval(() => setLockoutMs(getLockoutRemainingMs()), 500)
    return () => clearInterval(id)
  }, [locked])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (lockoutMs > 0) return
    if (await verifyPin(pin)) {
      resetAttempts()
      markUnlocked()
      setLocked(false)
      setError('')
    } else {
      const remainingAttempts = recordFailedAttempt()
      const nowLockedOut = getLockoutRemainingMs()
      setLockoutMs(nowLockedOut)
      setPin('')
      setError(
        nowLockedOut > 0
          ? 'Too many attempts — try again shortly'
          : `Incorrect PIN — ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} left`
      )
    }
  }

  if (!checked) return null
  if (!locked) return children

  const lockoutSeconds = Math.ceil(lockoutMs / 1000)

  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-5 bg-gray-50 px-6 dark:bg-neutral-950">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-2xl font-bold text-white shadow-lg shadow-indigo-500/30">
        🔒
      </div>
      <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Enter PIN to continue</h1>
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-3">
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          disabled={lockoutMs > 0}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value)
            setError('')
          }}
          className="input text-center text-lg tracking-[0.5em] disabled:opacity-50"
          maxLength={8}
        />
        {error && (
          <p className="text-xs text-red-600 text-center dark:text-red-400">
            {error}
            {lockoutMs > 0 && ` (${lockoutSeconds}s)`}
          </p>
        )}
        <button type="submit" disabled={!pin || lockoutMs > 0} className="btn-primary w-full py-3 text-sm">
          {lockoutMs > 0 ? `Locked (${lockoutSeconds}s)` : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
