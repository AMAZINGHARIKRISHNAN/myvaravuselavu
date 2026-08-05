import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'

// Dashboard shortcut to the scratchpad. Shows how many notes are still open
// and previews the top one (pinned wins, else the newest) so the reminder is
// visible without opening the page.
export default function NotesCard() {
  const notes = useCollection('notes')

  // No notes means no card: the empty state was a permanent invitation.
  if (notes.loading) return null
  if (notes.data.length === 0) return null

  const open = notes.data.filter((n) => !n.done)
  const preview = open.find((n) => n.pinned) || open[0]

  return (
    <Link
      to="/notes"
      className="card flex items-center gap-3 p-4 transition-transform active:scale-[0.99] touch-manipulation"
    >
      <span className="text-xl" aria-hidden="true">
        📝
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">Notes</span>
        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
          {preview
            ? `${preview.pinned ? '📌 ' : ''}${preview.text}`
            : 'Jot down anything — lists, reminders, amounts to check later'}
        </span>
      </span>
      {open.length > 0 && (
        <span className="shrink-0 rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
          {open.length}
        </span>
      )}
      <ChevronRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
    </Link>
  )
}
