import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { playSound } from '../lib/sound'

const ToastContext = createContext(null)

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

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>{children}</ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
