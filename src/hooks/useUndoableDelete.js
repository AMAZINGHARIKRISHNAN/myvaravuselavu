import { useEffect, useRef, useState } from 'react'
import { useToast } from '../context/ToastContext'

export function useUndoableDelete(remove, label) {
  const { toast } = useToast()
  const [pendingIds, setPendingIds] = useState(() => new Set())
  
  // Keep mutable references for the unmount and beforeunload handlers.
  // `removeRef` is refreshed in an effect rather than during render — React
  // only promises a render's work is real once it has committed, and this ref
  // is read from teardown handlers that must never call a stale writer.
  const pendingRef = useRef(new Set())
  const removeRef = useRef(remove)
  useEffect(() => {
    removeRef.current = remove
  })

  const clearPending = (id) => {
    pendingRef.current.delete(id)
    setPendingIds(new Set(pendingRef.current))
  }

  // Effect to handle beforeunload (tab close/refresh) and unmount
  useEffect(() => {
    const flushDeletes = () => {
      // Execute any remaining deletes immediately
      pendingRef.current.forEach((id) => {
        try {
          removeRef.current(id)
        } catch (e) {
          console.error('Failed to flush delete during cleanup:', e)
        }
      })
      pendingRef.current.clear()
    }

    // iOS Safari — including the installed PWA — frequently never fires
    // `beforeunload`; `pagehide` is the one teardown event it does deliver, so
    // both are wired up and flushDeletes() is written to be idempotent.
    window.addEventListener('beforeunload', flushDeletes)
    window.addEventListener('pagehide', flushDeletes)

    return () => {
      window.removeEventListener('beforeunload', flushDeletes)
      window.removeEventListener('pagehide', flushDeletes)
      flushDeletes()
    }
  }, [])

  const requestDelete = (id) => {
    pendingRef.current.add(id)
    setPendingIds(new Set(pendingRef.current))

    toast(`${label} deleted`, {
      actionLabel: 'Undo',
      onAction: () => clearPending(id),
      onExpire: () => {
        if (pendingRef.current.has(id)) {
          removeRef.current(id)
          clearPending(id)
        }
      },
    })
  }

  return { pendingIds, requestDelete }
}
