import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export default function RequireAuth({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-neutral-950">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-xl font-bold text-white shadow-lg shadow-indigo-500/30 animate-pulse">
          ¥
        </div>
        <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}
