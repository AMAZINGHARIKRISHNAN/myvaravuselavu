import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { subscribeToCollection, addRecord, addRecords, updateRecord, deleteRecord } from '../lib/firestore'
import { createSharedRegistry } from '../lib/subscriptionRegistry'
import { withinRange } from '../lib/dateRanges'
import { registerLiveData } from '../lib/liveData'

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
// Deliberately WITHOUT the date range.
//
// Keying by range meant one collection could be open several times at once
// under different windows — `expenses` was subscribed 23 times across the app,
// 10 of them all-time. Since those ten already download the whole collection
// every session, every range query was a second read of data the app was
// holding anyway. One listener per collection, sliced locally, costs strictly
// less and makes changing month instant.
export const keyFor = (uid, name) => `${uid}|${name}`

// Factory so the sharing/ref-count logic can be unit-tested with a fake
// `subscribe`, independent of React and Firestore. The ref-counting itself
// lives in subscriptionRegistry.js, which useSettings and useRecurring share;
// this only knows how a collection is keyed and subscribed to.
export function createRegistry(subscribe) {
  const shared = createSharedRegistry({ initialData: [] })
  registerLiveData(shared)
  return {
    clear: shared.clear,
    acquire: (uid, name, onState) =>
      shared.acquire(keyFor(uid, name), (handlers) => subscribe(uid, name, handlers), onState),
    size: shared.size,
  }
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
    const release = acquire(user.uid, name, (entry) => {
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
  }, [user, name, enabled])

  // The window is applied here rather than in the query, so switching month is
  // a memo instead of a round trip.
  const data = useMemo(
    () => withinRange(state.data, dateRange),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.data, startMs, endMs]
  )

  const add = (record) => addRecord(user.uid, name, record)
  const addMany = (records) => addRecords(user.uid, name, records)
  const update = (id, record) => updateRecord(user.uid, name, id, record)
  const remove = (id) => deleteRecord(user.uid, name, id)

  return { data, loading: state.loading, error: state.error, add, addMany, update, remove }
}
