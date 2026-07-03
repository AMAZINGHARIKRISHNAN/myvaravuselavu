import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribeToSettings, saveSettings, ensureSettingsExist } from '../lib/firestore'

export function useSettings() {
  const { user } = useAuth()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    ensureSettingsExist(user.uid)
    const unsubscribe = subscribeToSettings(user.uid, {
      onData: (data) => {
        setSettings(data)
        setLoading(false)
      },
      onError: () => setLoading(false),
    })
    return unsubscribe
  }, [user])

  const save = (data) => saveSettings(user.uid, data)

  return { settings, loading, save }
}
