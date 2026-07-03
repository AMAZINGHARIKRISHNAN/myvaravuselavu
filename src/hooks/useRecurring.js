import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  subscribeToRecurring,
  addRecurring,
  updateRecurring,
  deleteRecurring,
} from '../lib/firestore'

export function useRecurring() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    const unsubscribe = subscribeToRecurring(user.uid, {
      onData: (records) => {
        setData(records)
        setLoading(false)
      },
      onError: () => setLoading(false),
    })
    return unsubscribe
  }, [user])

  const add = (record) => addRecurring(user.uid, record)
  const update = (id, record) => updateRecurring(user.uid, id, record)
  const remove = (id) => deleteRecurring(user.uid, id)

  return { data, loading, add, update, remove }
}
