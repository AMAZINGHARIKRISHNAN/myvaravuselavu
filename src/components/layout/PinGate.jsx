import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  hasPin,
  isUnlocked,
  verifyPin,
  markUnlocked,
  clearPin,
  getLockoutRemainingMs,
  recordFailedAttempt,
  resetAttempts,
} from '../../lib/appLock'

export default function PinGate({ children }) {
  const { logout } = useAuth()
  const [locked, setLocked] = useState(false)
  const [checked, setChecked] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [lockoutMs, setLockoutMs] = useState(0)
  const [forgot, setForgot] = useState(false)

  // Forgetting the PIN used to be unrecoverable: the only way back into your
  // own data was clearing site data from browser settings, which most people
  // will never find on a phone.
  //
  // Signing out is a safe way out because the PIN was never the thing keeping
  // anyone else out — the Firestore rules are, and they answer to Firebase Auth.
  // The PIN is a convenience over the top of that, so trading it for a full
  // re-authentication is a STRICTER check, not a weaker one. Nothing is
  // deleted: the records live in the account, and signing back in restores them.
  const handleForgot = async () => {
    clearPin()
    try {
      await logout()
    } catch {
      /* already signed out, or offline — the gate is gone either way */
    }
    setLocked(false)
  }

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
    <div className="min-h-svh flex flex-col items-center justify-center gap-5 bg-gray-900 px-6 dark:bg-neutral-950">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white dark:bg-indigo-500">
        <Lock size={24} aria-hidden="true" />
      </div>
      <h1 className="text-sm font-semibold text-gray-100">Enter PIN to continue</h1>
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

      {/* The way out. Two steps, because signing out is not what someone
          fat-fingering their PIN wants — but one step from being genuinely
          stuck, which is the state this exists for. */}
      {forgot ? (
        <div className="w-full max-w-xs space-y-2 text-center">
          <p className="text-xs text-gray-400">
            Signing out clears the PIN. Nothing is deleted — your records live in
            your account, and signing back in brings everything with it.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForgot(false)}
              className="min-h-11 rounded-xl px-3 text-xs font-medium text-gray-400"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleForgot}
              className="min-h-11 rounded-xl bg-red-500/15 px-3 text-xs font-semibold text-red-400"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setForgot(true)}
          className="min-h-11 px-3 text-xs font-medium text-gray-400 underline-offset-4 hover:underline"
        >
          Forgot your PIN?
        </button>
      )}
    </div>
  )
}
