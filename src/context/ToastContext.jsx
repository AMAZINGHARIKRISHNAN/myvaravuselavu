import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message, { actionLabel, onAction, onExpire, duration = 5000 } = {}) => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { id, message, actionLabel, onAction }])
      setTimeout(() => {
        setToasts((prev) => {
          if (prev.some((t) => t.id === id)) onExpire?.()
          return prev.filter((t) => t.id !== id)
        })
      }, duration)
      return id
    },
    []
  )

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>{children}</ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
