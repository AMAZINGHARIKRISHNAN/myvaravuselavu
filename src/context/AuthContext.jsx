import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { closeAllLiveData } from '../lib/liveData'
import { auth } from '../lib/firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const login = useCallback(
    (email, password) => signInWithEmailAndPassword(auth, email, password),
    []
  )
  const logout = useCallback(async () => {
    // Close every warm listener FIRST: they outlive their last consumer now, so
    // signing out while they idle would leave them reading documents the user
    // no longer has permission for.
    closeAllLiveData()
    await signOut(auth)
  }, [])

  // Memoised so every consumer is not re-rendered by an unrelated render of
  // this provider — the value only genuinely changes at sign-in and sign-out.
  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
