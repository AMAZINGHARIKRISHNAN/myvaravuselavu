import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { subscribeToCollection, addRecord, addRecords, updateRecord, deleteRecord } from '../lib/firestore'

export function useCollection(name, { dateRange, enabled = true } = {}) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user || !enabled) return
    setLoading(true)
    const unsubscribe = subscribeToCollection(user.uid, name, {
      onData: (records) => {
        setData(records)
        setLoading(false)
      },
      onError: (err) => {
        setError(err)
        setLoading(false)
        toast(`⚠️ Could not load ${name} — check your connection`)
      },
      dateRange,
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, name, enabled, dateRange?.start?.getTime(), dateRange?.end?.getTime()])

  const add = (record) => addRecord(user.uid, name, record)
  const addMany = (records) => addRecords(user.uid, name, records)
  const update = (id, record) => updateRecord(user.uid, name, id, record)
  const remove = (id) => deleteRecord(user.uid, name, id)

  return { data, loading, error, add, addMany, update, remove }
}
