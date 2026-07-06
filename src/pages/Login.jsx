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
    <div className="relative min-h-svh flex items-center justify-center overflow-hidden bg-gray-50 px-4 dark:bg-neutral-950">
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
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white dark:bg-indigo-500">
            ¥
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">MyVaravuSelavu</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Sign in to your tracker</p>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
          <input
            type="password"
            required
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
