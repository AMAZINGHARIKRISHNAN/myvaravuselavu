import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import Portal from './Portal'

// One anchor point in the corner, two actions behind it.
//
// This replaces a stack of two floating buttons — "+" at bottom-5rem and the
// assistant at bottom-9rem, 8px apart — which read as one blob and gave the
// assistant no name at all: it was a bare cyan dot, and nothing told you what
// it did or how it differed from the plus beside it.
//
// Now there is a single button. Tap it and the actions fan upward, each with a
// visible label, so what they do is readable rather than guessable. Closed, it
// occupies the one spot a thumb already reaches for.
export default function SpeedDial({ actions = [], label = 'Add' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  // Escape closes, matching every other dismissible surface in the app.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const run = (action) => {
    if (navigator.vibrate) navigator.vibrate(10)
    setOpen(false)
    action.onClick()
  }

  return (
    <Portal>
      {/* A scrim while open: tapping anywhere closes, and it stops a stray tap
          landing on the page underneath mid-decision. z-40 so it also covers
          the tab bar — a dimmed screen with one undimmed strip of live
          navigation across the bottom is neither open nor closed. The dial
          itself renders after it in the overlay root, so it stays on top. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/25 animate-[fade-in_0.15s_ease-out]"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        ref={rootRef}
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex flex-col items-end gap-2.5 lg:bottom-8 lg:right-8"
      >
        {open &&
          actions.map((action, i) => (
            <button
              key={action.label}
              type="button"
              onClick={() => run(action)}
              // Staggered so they read as fanning out rather than appearing at
              // once — the last one listed sits nearest the thumb.
              style={{ animationDelay: `${(actions.length - 1 - i) * 40}ms` }}
              className="flex items-center gap-2.5 animate-[toast-in_0.18s_ease-out_both]"
            >
              <span className="rounded-lg bg-neutral-900/90 px-2.5 py-1 text-xs font-medium text-white shadow-lg backdrop-blur dark:bg-neutral-800/90">
                {action.label}
              </span>
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform active:scale-90 ${action.tint}`}
              >
                {action.icon}
              </span>
            </button>
          ))}

        <button
          type="button"
          onClick={() => {
            if (navigator.vibrate) navigator.vibrate(10)
            setOpen((v) => !v)
          }}
          aria-label={open ? 'Close menu' : label}
          aria-expanded={open}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/35 transition-all duration-150 hover:bg-indigo-500 hover:scale-105 active:scale-90 touch-manipulation dark:bg-indigo-500 dark:shadow-indigo-500/25 dark:hover:bg-indigo-400"
        >
          <span className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
            {open ? <X size={24} aria-hidden="true" /> : <Plus size={24} aria-hidden="true" />}
          </span>
        </button>
      </div>
    </Portal>
  )
}
