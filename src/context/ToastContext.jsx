import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { playSound } from '../lib/sound'

// TWO contexts, deliberately.
//
// Every confirmation in this app is a toast, so `toast()` is called from almost
// everywhere — 33 components, including useCollection, which puts every screen
// holding data in the audience. When the list and the function shared one
// context object, changing the list re-rendered all of them: saving a single
// expense re-rendered the entire app to show one message.
//
// Only the renderer needs the list. Everyone else needs a function that never
// changes, so `useToast()` now subscribes to nothing that moves and costs a
// consumer no renders at all.
const ToastDispatchContext = createContext(null)
const ToastStateContext = createContext(null)

// Every confirmation in this app arrives as a toast, so this is the one place
// that knows something succeeded or failed — which makes it the honest place to
// put the sound. A message that leads with a warning sign is a failure.
const isFailure = (message) =>
  typeof message === 'string' && /^[⚠❌]|could not|failed/i.test(message.trim())

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)
  // Deferred work (e.g. an undoable delete) keyed by toast id. Kept in a ref
  // so the pagehide flush below can run it synchronously.
  const pendingExpires = useRef(new Map())

  const dismiss = useCallback((id) => {
    pendingExpires.current.delete(id)
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message, { actionLabel, onAction, onExpire, duration = 5000 } = {}) => {
      const id = nextId.current++
      if (onExpire) pendingExpires.current.set(id, onExpire)
      setToasts((prev) => [...prev, { id, message, actionLabel, onAction }])
      playSound(isFailure(message) ? 'error' : 'confirm', document.documentElement.dataset.skin)
      setTimeout(() => {
        const expire = pendingExpires.current.get(id)
        pendingExpires.current.delete(id)
        expire?.()
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
      return id
    },
    []
  )

  // If the app is closed or backgrounded away mid-undo-window, commit the
  // pending work now — otherwise a "deleted" record would silently reappear
  // on next launch. pagehide is the last event installed PWAs reliably get.
  useEffect(() => {
    const flush = () => {
      for (const expire of pendingExpires.current.values()) expire()
      pendingExpires.current.clear()
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  // Both callbacks are already stable, so this object is created once and the
  // dispatch context never notifies anyone again.
  const dispatch = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastDispatchContext.Provider value={dispatch}>
      <ToastStateContext.Provider value={toasts}>{children}</ToastStateContext.Provider>
    </ToastDispatchContext.Provider>
  )
}

// Showing a toast. Subscribes to nothing that changes, so calling this never
// costs a re-render — which is why it is safe to use it as widely as it is.
export function useToast() {
  return useContext(ToastDispatchContext)
}

// The live list. For the renderer alone: anything using this re-renders on
// every toast, which is exactly what it is for and exactly what nothing else
// should do.
export function useToastList() {
  return useContext(ToastStateContext)
}
