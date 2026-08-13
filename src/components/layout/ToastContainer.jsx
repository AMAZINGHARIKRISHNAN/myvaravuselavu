import { useToast, useToastList } from '../../context/ToastContext'

export default function ToastContainer() {
  // The one component that wants to re-render on every toast.
  const toasts = useToastList()
  const { dismiss } = useToast()

  if (toasts.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-0 right-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none lg:bottom-8"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-gray-900 shadow-xl ring-1 ring-black/5 animate-[toast-in_0.2s_ease-out] dark:bg-neutral-100 dark:text-neutral-900 dark:ring-0"
        >
          <span>{t.message}</span>
          {t.actionLabel && (
            <button
              type="button"
              onClick={() => {
                t.onAction?.()
                dismiss(t.id)
              }}
              className="shrink-0 font-semibold text-indigo-600"
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
