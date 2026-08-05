import { useRef, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'

// Mail-style swipe actions for list rows: drag right to edit, left to delete.
// Touch-only — desktop keeps the visible buttons. `touch-action: pan-y` lets
// vertical scrolling pass through while horizontal drags stay with us.
const TRIGGER = 72 // px of drag needed to fire the action on release
const MAX_PULL = 96

export default function SwipeableRow({ onEdit, onDelete, children }) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Swipe-to-delete asks first — a stray horizontal drag while scrolling
  // shouldn't be able to remove a record on its own.
  const [confirming, setConfirming] = useState(false)
  const start = useRef(null)
  const engaged = useRef(false)

  const handleTouchStart = (e) => {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY }
    engaged.current = false
  }

  const handleTouchMove = (e) => {
    if (!start.current) return
    const t = e.touches[0]
    const deltaX = t.clientX - start.current.x
    const deltaY = t.clientY - start.current.y
    if (!engaged.current) {
      // Ignore until the gesture is clearly horizontal, so scrolling wins.
      if (Math.abs(deltaX) < 12 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return
      engaged.current = true
      setDragging(true)
    }
    let pull = Math.max(-MAX_PULL, Math.min(MAX_PULL, deltaX))
    if ((pull > 0 && !onEdit) || (pull < 0 && !onDelete)) pull = 0
    setDx(pull)
  }

  const handleTouchEnd = () => {
    if (dx <= -TRIGGER && onDelete) {
      if (navigator.vibrate) navigator.vibrate(10)
      setConfirming(true)
    } else if (dx >= TRIGGER && onEdit) {
      if (navigator.vibrate) navigator.vibrate(10)
      onEdit()
    }
    setDx(0)
    setDragging(false)
    start.current = null
    engaged.current = false
  }

  return (
    <div className="relative overflow-hidden rounded-2xl [touch-action:pan-y]">
      {/* Action backgrounds revealed by the drag */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 flex items-center justify-between rounded-2xl px-5 transition-opacity ${
          dx > 0 ? 'bg-indigo-500' : dx < 0 ? 'bg-red-500' : 'opacity-0'
        }`}
      >
        <span className={`text-white transition-transform ${dx >= TRIGGER ? 'scale-125' : ''} ${dx > 0 ? '' : 'invisible'}`}>
          <Pencil size={18} />
        </span>
        <span className={`text-white transition-transform ${dx <= -TRIGGER ? 'scale-125' : ''} ${dx < 0 ? '' : 'invisible'}`}>
          <Trash2 size={18} />
        </span>
      </div>
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{ transform: `translateX(${dx}px)` }}
        className={dragging ? '' : 'transition-transform duration-200'}
      >
        {children}
      </div>

      {/* Confirmation popup — nothing is removed until "Remove" is tapped. */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 animate-[toast-in_0.15s_ease-out]"
          onClick={() => setConfirming(false)}
        >
          <div
            role="alertdialog"
            aria-label="Remove this?"
            className="w-full max-w-xs space-y-3 rounded-2xl bg-white p-4 shadow-xl dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              🗑 Shall we remove this?
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              After removing you still get a short Undo chance in the toast below.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn-ghost py-2.5 text-sm"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false)
                  onDelete()
                }}
                className="rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white transition-transform active:scale-95 touch-manipulation"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
