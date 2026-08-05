import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Search, Pin, PinOff, Pencil, Trash2, Check, Plus } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { useToast } from '../context/ToastContext'
import { toDate } from '../lib/format'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'
import SwipeableRow from '../components/ui/SwipeableRow'

// A plain scratchpad that lives with the money: shopping lists, "ask the
// landlord about the aircon", amounts to remember before they become real
// expenses. Notes carry a `date` because every collection here is ordered by
// it, but the list sorts pinned-first so the things you actually care about
// stay on top no matter when you wrote them.

const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
]

export default function Notes() {
  const notes = useCollection('notes')
  const { toast } = useToast()
  const undo = useUndoableDelete(notes.remove, 'Note')
  const [text, setText] = useState('')
  const [tab, setTab] = useState('open')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [saving, setSaving] = useState(false)
  const composerRef = useRef(null)

  const searchLower = search.trim().toLowerCase()

  const visible = useMemo(() => {
    const rows = notes.data.filter((n) => {
      if (undo.pendingIds.has(n.id)) return false
      if (tab === 'open' && n.done) return false
      if (tab === 'done' && !n.done) return false
      if (searchLower && !n.text?.toLowerCase().includes(searchLower)) return false
      return true
    })
    // Pinned first, then newest — the array from Firestore is already date-desc.
    return [...rows].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
  }, [notes.data, undo.pendingIds, tab, searchLower])

  const openCount = notes.data.filter((n) => !n.done && !undo.pendingIds.has(n.id)).length

  const handleAdd = async (e) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || saving) return
    setSaving(true)
    try {
      await notes.add({ text: body, pinned: false, done: false, date: new Date() })
      setText('')
      composerRef.current?.focus()
    } catch {
      toast('⚠️ Could not save the note — check your connection')
    }
    setSaving(false)
  }

  // Fire-and-forget toggles still need a catch, or a failed write becomes an
  // unhandled rejection with no sign to the user that nothing was saved.
  const patch = (id, data) =>
    notes.update(id, data).catch(() => toast('⚠️ Could not save — check your connection'))

  const startEdit = (note) => {
    setEditingId(note.id)
    setEditingText(note.text || '')
  }

  const saveEdit = async (id) => {
    const body = editingText.trim()
    if (!body) return // an emptied note is a delete — use the bin for that
    setEditingId(null)
    try {
      await notes.update(id, { text: body })
    } catch {
      toast('⚠️ Could not save the change')
    }
  }

  // Ctrl/⌘+Enter submits from the textarea; plain Enter still adds a newline.
  const submitOnCmdEnter = (e, submit) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="space-y-4 pb-16 lg:mx-auto lg:max-w-3xl lg:pb-0">
      <div className="card p-4 space-y-2">
        <form onSubmit={handleAdd} className="space-y-2">
          <textarea
            ref={composerRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => submitOnCmdEnter(e, () => handleAdd(e))}
            placeholder="Write anything — a shopping list, a reminder, an amount to check later…"
            rows={3}
            className="input resize-y"
          />
          <button
            type="submit"
            disabled={!text.trim() || saving}
            className="btn-primary flex w-full items-center justify-center gap-1.5 py-2.5 text-sm"
          >
            <Plus size={15} aria-hidden="true" />
            {saving ? 'Saving…' : 'Add note'}
          </button>
        </form>
      </div>

      <div className="flex rounded-full border border-gray-300/80 bg-white p-1 shadow-sm dark:border-white/5 dark:bg-neutral-900 dark:shadow-none">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-full py-2 text-sm font-medium transition-all active:scale-95 touch-manipulation ${
              tab === t.key
                ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            {t.label}
            {t.key === 'open' && openCount > 0 && (
              <span className={tab === 'open' ? ' opacity-80' : ' text-gray-400'}> · {openCount}</span>
            )}
          </button>
        ))}
      </div>

      {notes.data.length > 3 && (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
            <Search size={15} aria-hidden="true" />
          </span>
          <input
            type="text"
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9"
          />
        </div>
      )}

      <div className="space-y-2">
        {notes.loading && (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}

        {!notes.loading && visible.length === 0 && (
          <EmptyState
            icon="📝"
            message={
              searchLower
                ? 'No notes match'
                : tab === 'done'
                  ? 'Nothing ticked off yet'
                  : 'No notes yet — write your first one above'
            }
            actionLabel={searchLower ? undefined : 'Write a note'}
            onAction={searchLower ? undefined : () => composerRef.current?.focus()}
          />
        )}

        {visible.map((note) => {
          const created = toDate(note.date)
          return (
            <SwipeableRow
              key={note.id}
              onEdit={() => startEdit(note)}
              onDelete={() => undo.requestDelete(note.id)}
            >
              <div className="card animate-[toast-in_0.15s_ease-out] p-3 pl-4">
                {editingId === note.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => submitOnCmdEnter(e, () => saveEdit(note.id))}
                      rows={3}
                      autoFocus
                      className="input resize-y"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(note.id)}
                        disabled={!editingText.trim()}
                        className="btn-primary flex-1 py-2 text-xs"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="btn-ghost flex-1 py-2 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    {/* Tick it off without deleting — done notes stay searchable. */}
                    <button
                      type="button"
                      onClick={() => patch(note.id, { done: !note.done })}
                      aria-label={note.done ? 'Mark as not done' : 'Mark as done'}
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-all active:scale-90 touch-manipulation ${
                        note.done
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-gray-300 text-transparent hover:border-emerald-400 dark:border-neutral-600'
                      }`}
                    >
                      <Check size={13} strokeWidth={3} />
                    </button>

                    <div className="min-w-0 flex-1">
                      <p
                        className={`whitespace-pre-wrap break-words text-sm ${
                          note.done
                            ? 'text-gray-400 line-through dark:text-gray-500'
                            : 'text-gray-900 dark:text-gray-100'
                        }`}
                      >
                        {note.text}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                        {note.pinned && '📌 Pinned · '}
                        {created ? format(created, 'EEE, d MMM yyyy · HH:mm') : ''}
                      </p>
                    </div>

                    <div className="flex shrink-0">
                      <button
                        type="button"
                        onClick={() => patch(note.id, { pinned: !note.pinned })}
                        aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
                        className={`flex h-9 w-9 items-center justify-center rounded-full transition-all active:scale-90 touch-manipulation ${
                          note.pinned
                            ? 'text-indigo-500 dark:text-indigo-400'
                            : 'text-gray-400 hover:text-indigo-600 dark:text-gray-500 dark:hover:text-indigo-400'
                        }`}
                      >
                        {note.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(note)}
                        aria-label="Edit note"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-all hover:text-indigo-600 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-indigo-400"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => undo.requestDelete(note.id)}
                        aria-label="Delete note"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-red-400"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </SwipeableRow>
          )
        })}
      </div>
    </div>
  )
}
