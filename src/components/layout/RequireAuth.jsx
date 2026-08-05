import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import BootSplash from './BootSplash'

export default function RequireAuth({ children }) {
  const { user, loading } = useAuth()

  // BootSplash stays blank for its first 400ms, so a fast auth resolve — which
  // is nearly all of them — shows nothing at all rather than a flash.
  if (loading) return <BootSplash />

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}
