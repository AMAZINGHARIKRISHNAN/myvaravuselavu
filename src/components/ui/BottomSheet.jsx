import { useEffect, useRef, useState } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
const DISMISS_AT = 110 // px of downward drag that closes the sheet

// Shared bottom-sheet dialog: overlay + panel, body scroll lock, Escape to close,
// focus containment, drag-down-to-dismiss, and safe-area padding for
// standalone/home-screen PWAs. Pass `title` for the standard header, or omit
// it and render your own.
export default function BottomSheet({ onClose, title, as: Tag = 'div', onSubmit, children }) {
  const panelRef = useRef(null)

  // Drag-to-dismiss: only engages when the sheet's content is scrolled to the
  // top and the finger moves clearly downward, so inner scrolling still wins.
  const [dragY, setDragY] = useState(0)
  const startY = useRef(null)
  const engaged = useRef(false)

  const handleTouchStart = (e) => {
    startY.current = panelRef.current?.scrollTop <= 0 ? e.touches[0].clientY : null
    engaged.current = false
  }

  const handleTouchMove = (e) => {
    if (startY.current === null) return
    const dy = e.touches[0].clientY - startY.current
    if (!engaged.current) {
      if (dy < 12) return // not a deliberate downward pull yet
      engaged.current = true
    }
    // Slight resistance so the sheet feels attached, not loose.
    setDragY(Math.max(0, dy * 0.7))
  }

  const handleTouchEnd = () => {
    if (dragY > DISMISS_AT) {
      onClose()
    } else {
      setDragY(0)
    }
    startY.current = null
    engaged.current = false
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const nodes = panelRef.current?.querySelectorAll(FOCUSABLE)
      if (!nodes?.length) return
      const focusable = [...nodes].filter((n) => !n.disabled)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    // Move focus into the dialog without popping the mobile keyboard.
    panelRef.current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 animate-[fade-in_0.15s_ease-out]"
    >
      <Tag
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
        className={`sheet-surface bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4 max-h-[92svh] overflow-y-auto outline-none dark:bg-neutral-900 dark:border dark:border-white/10 animate-[sheet-up_0.22s_cubic-bezier(0.32,0.72,0,1)] shadow-2xl ${
          dragY ? '' : 'transition-transform duration-200'
        }`}
      >
        <span
          aria-hidden="true"
          className="mx-auto -mt-1 block h-1 w-9 rounded-full bg-gray-300 dark:bg-neutral-700 sm:hidden"
        />
        {title && (
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300/60 bg-gray-100 text-gray-500 transition-transform active:scale-90 dark:border-transparent dark:bg-neutral-800 dark:text-gray-400"
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </Tag>
    </div>
  )
}
