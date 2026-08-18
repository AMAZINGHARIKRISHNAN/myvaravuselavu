import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from '../components/layout/ThemeToggle'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch {
      setError('Invalid email or password.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-svh flex items-center justify-center overflow-hidden bg-gray-900 px-4 dark:bg-neutral-950">
      <div className="pointer-events-none absolute -top-32 -left-24 h-72 w-72 rounded-full bg-indigo-400/30 blur-3xl dark:bg-indigo-500/20" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-72 w-72 rounded-full bg-violet-400/30 blur-3xl dark:bg-violet-500/20" />

      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm card p-8 space-y-5"
      >
        <div className="text-center space-y-1">
          <img src="/logo.svg" alt="MyVaravuSelavu logo" className="mx-auto mb-3 h-14 w-14" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">MyVaravuSelavu</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Sign in to your tracker</p>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Real labels, visually hidden.
            A placeholder is not a label: it disappears the moment you type, and
            a screen reader announcing "edit text" tells you nothing about which
            field you are in. The design keeps the placeholder look; the label
            exists for anything that is not a pair of eyes. */}
        <div className="space-y-3">
          <label htmlFor="login-email" className="sr-only">
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
          <label htmlFor="login-password" className="sr-only">
            Password
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
        </div>

        <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5 text-sm">
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
