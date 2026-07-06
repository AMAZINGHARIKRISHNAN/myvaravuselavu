import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

// Shared bottom-sheet dialog: overlay + panel, body scroll lock, Escape to close,
// focus containment, and safe-area padding for standalone/home-screen PWAs.
// Pass `title` for the standard header, or omit it and render your own.
export default function BottomSheet({ onClose, title, as: Tag = 'div', onSubmit, children }) {
  const panelRef = useRef(null)

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
        className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4 max-h-[92svh] overflow-y-auto outline-none dark:bg-neutral-900 dark:border dark:border-white/10 animate-[sheet-up_0.22s_cubic-bezier(0.32,0.72,0,1)] shadow-2xl"
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
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-transform active:scale-90 dark:bg-neutral-800 dark:text-gray-400"
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
