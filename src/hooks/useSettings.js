import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribeToSettings, saveSettings, ensureSettingsExist } from '../lib/firestore'
import { createSharedRegistry } from '../lib/subscriptionRegistry'
import { registerLiveData } from '../lib/liveData'

// Settings is ONE document that most of the app wants — thirty-odd call sites,
// five of them on the Dashboard alone. Each used to open its own listener and
// fire its own ensureSettingsExist() read on mount, so simply landing on the
// home screen cost five snapshot attaches and five getDocs for a single doc
// that never differs between them. Sharing one listener per signed-in user
// makes every extra caller free.
const { acquire } = registerLiveData(createSharedRegistry({ initialData: null }))

export function useSettings() {
  const { user } = useAuth()
  const [state, setState] = useState({ settings: null, loading: true })

  useEffect(() => {
    if (!user) {
      setState({ settings: null, loading: false })
      return
    }
    return acquire(
      user.uid,
      (handlers) => {
        // Inside the subscribe thunk, so the create-if-missing check runs once
        // when the listener is opened rather than once per component.
        ensureSettingsExist(user.uid)
        return subscribeToSettings(user.uid, handlers)
      },
      (entry) => setState({ settings: entry.data, loading: entry.loading })
    )
  }, [user])

  const save = (data) => saveSettings(user.uid, data)

  return { settings: state.settings, loading: state.loading, save }
}
