import { useState } from 'react'
import { useToast } from '../context/ToastContext'

export function useUndoableDelete(remove, label) {
  const { toast } = useToast()
  const [pendingIds, setPendingIds] = useState(() => new Set())

  const clearPending = (id) => {
    setPendingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const requestDelete = (id) => {
    setPendingIds((prev) => new Set(prev).add(id))
    toast(`${label} deleted`, {
      actionLabel: 'Undo',
      onAction: () => clearPending(id),
      onExpire: () => {
        remove(id)
        clearPending(id)
      },
    })
  }

  return { pendingIds, requestDelete }
}
