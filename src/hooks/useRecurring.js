import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  subscribeToRecurring,
  addRecurring,
  updateRecurring,
  deleteRecurring,
} from '../lib/firestore'
import { createSharedRegistry } from '../lib/subscriptionRegistry'
import { registerLiveData } from '../lib/liveData'

// Shared for the same reason useSettings is: the Dashboard renders both the
// safe-to-spend figure and the "due this month" card, and each was opening its
// own listener on the same short list.
const { acquire } = registerLiveData(createSharedRegistry({ initialData: [] }))

export function useRecurring() {
  const { user } = useAuth()
  const [state, setState] = useState({ data: [], loading: true })

  useEffect(() => {
    if (!user) {
      setState({ data: [], loading: false })
      return
    }
    return acquire(
      user.uid,
      (handlers) => subscribeToRecurring(user.uid, handlers),
      (entry) => setState({ data: entry.data, loading: entry.loading })
    )
  }, [user])

  const add = (record) => addRecurring(user.uid, record)
  const update = (id, record) => updateRecurring(user.uid, id, record)
  const remove = (id) => deleteRecurring(user.uid, id)

  return { data: state.data, loading: state.loading, add, update, remove }
}
