import { useAuth } from '../context/AuthContext'
import { commitOps } from '../lib/firestore'

// Atomic cross-collection writes for the signed-in user — see commitOps.
export function useBatchOps() {
  const { user } = useAuth()
  return (ops) => commitOps(user.uid, ops)
}
