import { useToast } from '../../context/ToastContext'

export default function ToastContainer() {
  const { toasts, dismiss } = useToast()

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
          className="pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-2xl bg-gray-900 px-4 py-3 text-sm text-white shadow-xl animate-[toast-in_0.2s_ease-out] dark:bg-neutral-100 dark:text-neutral-900"
        >
          <span>{t.message}</span>
          {t.actionLabel && (
            <button
              type="button"
              onClick={() => {
                t.onAction?.()
                dismiss(t.id)
              }}
              className="shrink-0 font-semibold text-indigo-300 dark:text-indigo-600"
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
