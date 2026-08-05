import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { subscribeToCollection, addRecord, addRecords, updateRecord, deleteRecord } from '../lib/firestore'

// ---- Shared subscription registry ------------------------------------------
//
// Many components need the same collection at once — the Dashboard alone used
// to open `expenses` seven times over. Each useCollection previously started
// its own Firestore listener, so identical data was fetched again and again,
// adding latency and burning the free plan's read quota.
//
// Instead, one live listener is shared by everyone asking for the same
// collection+range. Consumers are ref-counted; the listener closes only when
// the last one unmounts. A newcomer gets the already-loaded data immediately,
// with no spinner and no extra read.
export const keyFor = (uid, name, dateRange) =>
  `${uid}|${name}|${dateRange?.start?.getTime() ?? ''}|${dateRange?.end?.getTime() ?? ''}`

// Factory so the sharing/ref-count logic can be unit-tested with a fake
// `subscribe`, independent of React and Firestore.
export function createRegistry(subscribe) {
  const registry = new Map()

  function acquire(uid, name, dateRange, onState) {
    const key = keyFor(uid, name, dateRange)
    let entry = registry.get(key)
    if (!entry) {
      entry = { data: [], loading: true, error: null, refs: 0, listeners: new Set(), unsub: null }
      registry.set(key, entry)
      entry.unsub = subscribe(uid, name, {
        onData: (records) => {
          entry.data = records
          entry.loading = false
          entry.error = null
          entry.listeners.forEach((fn) => fn(entry))
        },
        onError: (err) => {
          entry.error = err
          entry.loading = false
          entry.listeners.forEach((fn) => fn(entry))
        },
        dateRange,
      })
    }
    entry.refs += 1
    entry.listeners.add(onState)
    onState(entry) // hand over whatever is cached right now

    return () => {
      entry.listeners.delete(onState)
      entry.refs -= 1
      if (entry.refs === 0) {
        entry.unsub?.()
        registry.delete(key)
      }
    }
  }

  return { acquire, size: () => registry.size }
}

const { acquire } = createRegistry(subscribeToCollection)

export function useCollection(name, { dateRange, enabled = true } = {}) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [state, setState] = useState({ data: [], loading: enabled, error: null })
  const erroredRef = useRef(false)

  const startMs = dateRange?.start?.getTime()
  const endMs = dateRange?.end?.getTime()

  useEffect(() => {
    if (!user || !enabled) {
      setState({ data: [], loading: false, error: null })
      return
    }
    const release = acquire(user.uid, name, dateRange, (entry) => {
      setState({ data: entry.data, loading: entry.loading, error: entry.error })
      // Toast once per error episode, not on every shared update.
      if (entry.error && !erroredRef.current) {
        erroredRef.current = true
        toast(`⚠️ Could not load ${name} — check your connection`)
      } else if (!entry.error) {
        erroredRef.current = false
      }
    })
    return release
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, name, enabled, startMs, endMs])

  const add = (record) => addRecord(user.uid, name, record)
  const addMany = (records) => addRecords(user.uid, name, records)
  const update = (id, record) => updateRecord(user.uid, name, id, record)
  const remove = (id) => deleteRecord(user.uid, name, id)

  return { data: state.data, loading: state.loading, error: state.error, add, addMany, update, remove }
}
