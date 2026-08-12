import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { formatByCountry, formatJPY, toDate } from '../../lib/format'
import BottomSheet from '../ui/BottomSheet'

// One search box over every record type — expenses, income, transfers and
// friend purchases — opened from the app header. Firestore subscriptions only
// start when the sheet actually opens (the sheet component is mounted lazily),
// so the search costs nothing until it's used.

// Case-insensitive "does any of these fields contain the query?"
const matches = (q, ...fields) => fields.some((f) => f && String(f).toLowerCase().includes(q))

const MAX_PER_GROUP = 8 // keep the sheet scannable — refine the query for more

export default function GlobalSearch() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Trigger lives in the dark chrome (header/sidebar) in both themes */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search everything"
        className="flex tap-target h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/10 text-gray-200 transition-transform active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-800 dark:text-gray-300"
      >
        <Search size={15} aria-hidden="true" />
      </button>
      {open && <SearchSheet onClose={() => setOpen(false)} />}
    </>
  )
}

function SearchSheet({ onClose }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  // All four collections; each is a live subscription while the sheet is open.
  const expenses = useCollection('expenses')
  const income = useCollection('income')
  const transfers = useCollection('transfers')
  const friends = useCollection('friendPurchases')
  const orders = useCollection('onlineOrders')
  const notes = useCollection('notes')
  const officeItems = useCollection('officeReimbursements')

  const q = query.trim().toLowerCase()

  // Grouped results, newest first inside each group.
  const groups = useMemo(() => {
    if (q.length < 2) return []
    const byDateDesc = (a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0)
    const build = (label, path, rows, toRow) => ({
      label,
      path,
      rows: rows.sort(byDateDesc).slice(0, MAX_PER_GROUP).map(toRow),
    })
    return [
      build(
        '🧾 Expenses',
        '/history',
        expenses.data.filter((r) =>
          matches(q, r.note, r.category, r.paymentMethod, r.friend, r.store)
        ),
        (r) => ({
          id: r.id,
          title: r.note || r.store || r.category,
          sub: [r.category, r.paymentMethod, r.store && `🏪 ${r.store}`].filter(Boolean).join(' · '),
          amount: formatByCountry(r.amount, r.country || 'JP'),
          date: r.date,
        })
      ),
      build(
        '💰 Income',
        '/history',
        income.data.filter((r) => matches(q, r.note, r.source)),
        (r) => ({
          id: r.id,
          title: r.source || 'Income',
          sub: r.note || '',
          amount: formatJPY(r.amount),
          date: r.date,
        })
      ),
      build(
        '💸 Transfers',
        '/transfers',
        transfers.data.filter((r) => matches(q, r.note, r.recipient, r.method)),
        (r) => ({
          id: r.id,
          title: r.recipient || 'Transfer',
          sub: r.note || r.method || '',
          amount: formatJPY(r.amountSent || 0), // JPY side of the remittance
          date: r.date,
        })
      ),
      build(
        '🤝 Friends',
        '/friends',
        friends.data.filter((r) => matches(q, r.item, r.friend, r.note)),
        (r) => ({
          id: r.id,
          title: r.item,
          sub: r.friend,
          amount: formatByCountry(r.due, r.country || 'JP'),
          date: r.date,
        })
      ),
      build(
        '💼 Claims',
        '/reimbursements',
        officeItems.data.filter((r) => matches(q, r.item, r.vendor, r.purpose, r.note)),
        (r) => ({
          id: r.id,
          title: r.item || 'Claimable expense',
          sub: [r.vendor, r.status === 'received' ? 'reimbursed' : r.claimId ? 'on a report' : 'to claim']
            .filter(Boolean)
            .join(' · '),
          amount: formatJPY(r.amount || 0),
          date: r.date,
        })
      ),
      build(
        '🛍 Shopping',
        '/shopping',
        orders.data.filter((r) => matches(q, r.item, r.store, r.note)),
        (r) => ({
          id: r.id,
          title: r.item,
          sub: `${r.store}${r.status === 'returned' ? ' · returned' : ''}`,
          amount: formatJPY(r.total || 0),
          date: r.date,
        })
      ),
      build(
        '📝 Notes',
        '/notes',
        notes.data.filter((r) => matches(q, r.text)),
        (r) => ({
          id: r.id,
          title: r.text,
          sub: r.done ? 'done' : r.pinned ? '📌 pinned' : '',
          amount: '',
          date: r.date,
        })
      ),
    ].filter((g) => g.rows.length > 0)
  }, [
    q,
    expenses.data,
    income.data,
    transfers.data,
    friends.data,
    orders.data,
    notes.data,
    officeItems.data,
  ])

  const anyLoading =
    expenses.loading ||
    income.loading ||
    transfers.loading ||
    friends.loading ||
    orders.loading ||
    notes.loading

  // Jump to the page that owns the record type
  const go = (path) => {
    onClose()
    navigate(path)
  }

  return (
    <BottomSheet onClose={onClose} title="Search everything">
      <input
        type="text"
        autoFocus
        placeholder="Notes, stores, items, friends, categories…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="input"
      />

      {q.length < 2 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Type at least 2 characters — searches expenses (stores included), income, transfers, the
          friend ledger and your notes.
        </p>
      )}
      {q.length >= 2 && anyLoading && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Searching…</p>
      )}
      {q.length >= 2 && !anyLoading && groups.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">No matches for “{query.trim()}”.</p>
      )}

      {groups.map((g) => (
        <div key={g.label} className="space-y-1">
          <button
            type="button"
            onClick={() => go(g.path)}
            className="text-xs font-semibold text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400"
          >
            {g.label} →
          </button>
          {g.rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => go(g.path)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-100/80 px-3 py-2 text-left transition-transform active:scale-[0.99] dark:border-transparent dark:bg-neutral-800/50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                  {r.title}
                </span>
                <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
                  {toDate(r.date)?.toLocaleDateString()} {r.sub && `· ${r.sub}`}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                {r.amount}
              </span>
            </button>
          ))}
        </div>
      ))}
    </BottomSheet>
  )
}
