import { Plus } from 'lucide-react'

export default function FloatingActionButton({ onClick, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label || 'Add'}
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/35 transition-all duration-150 hover:bg-indigo-500 active:scale-90 touch-manipulation dark:bg-indigo-500 dark:shadow-indigo-500/25 dark:hover:bg-indigo-400 lg:bottom-8 lg:right-8"
    >
      {icon || <Plus size={24} aria-hidden="true" />}
    </button>
  )
}
