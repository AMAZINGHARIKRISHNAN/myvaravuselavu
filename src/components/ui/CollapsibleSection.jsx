import { useId, useState } from 'react'

export default function CollapsibleSection({ title, subtitle, icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between p-4 text-left transition-transform active:scale-[0.99]"
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {icon && <span className="mr-1.5">{icon}</span>}
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-gray-400 mt-0.5 truncate dark:text-gray-500">{subtitle}</p>
          )}
        </div>
        <span
          aria-hidden="true"
          className={`shrink-0 ml-3 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div id={contentId} role="region" className="px-4 pb-4 space-y-3">
          {children}
        </div>
      )}
    </div>
  )
}
