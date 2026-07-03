import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribeToCollection, addRecord, updateRecord, deleteRecord } from '../lib/firestore'

export function useCollection(name, { dateRange } = {}) {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    const unsubscribe = subscribeToCollection(user.uid, name, {
      onData: (records) => {
        setData(records)
        setLoading(false)
      },
      onError: (err) => {
        setError(err)
        setLoading(false)
      },
      dateRange,
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, name, dateRange?.start?.getTime(), dateRange?.end?.getTime()])

  const add = (record) => addRecord(user.uid, name, record)
  const update = (id, record) => updateRecord(user.uid, name, id, record)
  const remove = (id) => deleteRecord(user.uid, name, id)

  return { data, loading, error, add, update, remove }
}
