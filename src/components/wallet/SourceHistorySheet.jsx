import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { buildHistory, PREPAID_CARDS } from '../../lib/wallet'
import { formatByCountry } from '../../lib/format'
import BottomSheet from '../ui/BottomSheet'

// Everything that ever touched ONE source — a bank account, a prepaid card,
// or cash — newest first, signed and colored, so any balance can be read back
// to the entries that made it. Shared by the Wallet page and the dashboard's
// Accounts card, so both tell exactly the same story.
//
// Top-ups and hand-logged ➕/➖ entries can be revoked from here: they're
// self-contained, so deleting one puts both sides back exactly as they were.
// Expenses, income and transfers have counterparts elsewhere (commute trips,
// group ledgers, friend debts), so they're deleted from the screen that owns
// them — noted at the bottom.
export default function SourceHistorySheet({ source, data, onUndo, onUndoEntry, onClose }) {
  const rows = buildHistory(source.name, { ...data, country: source.country })
  const fmt = (v) => formatByCountry(v, source.country)
  // Anything dated before the reconcile point is real history but doesn't move
  // the balance — the number restarted from the figure you typed. Saying so
  // here is what turns "why doesn't my salary show up?" into an answer.
  // The cutoff arrives already resolved. It used to be re-derived here with
  // startOfDay, which was right for a bank account and wrong for a card: a card
  // restarts from the exact moment its balance was set, so rounding to midnight
  // would have counted that morning's purchases twice.
  const since = source.since || null
  const isCard = PREPAID_CARDS.some((c) => c.name === source.name)
  const counts = (r) => !since || !r.date || r.date >= since
  // Partitioned once. The counted rows drive the total, the count and the
  // wording, and filtering the same list for each of them was three extra
  // passes over the whole history every render.
  const counted = rows.filter(counts)
  const skipped = rows.length - counted.length

  // The sum this list adds up to. Listing movements without ever totalling
  // them means a balance can only be taken on trust — this is the arithmetic
  // written out, so `opening + movement` can be checked against the figure on
  // the card with your own eyes.
  const movement = counted.reduce((s, r) => s + r.amount, 0)

  const opening = Number.isFinite(source.opening) ? source.opening : null
  const closing = opening === null ? null : opening + movement

  return (
    <BottomSheet onClose={onClose} title={`${source.name} — history`}>
      {rows.length > 0 && (
        <div className="rounded-xl bg-gray-100/80 p-3 text-xs dark:bg-neutral-800/50">
          {opening !== null && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500 dark:text-gray-400">
                Starting balance{since ? ` · ${since.toLocaleDateString()}` : ''}
              </span>
              <span className="tabular-nums text-gray-700 dark:text-gray-200">{fmt(opening)}</span>
            </div>
          )}
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-gray-500 dark:text-gray-400">
              {counted.length} movement
              {counted.length === 1 ? '' : 's'} since
            </span>
            <span
              className={`tabular-nums font-medium ${
                movement >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-gray-700 dark:text-gray-200'
              }`}
            >
              {movement >= 0 ? '+' : '−'}
              {fmt(Math.abs(movement))}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-gray-300/60 pt-1.5 dark:border-white/10">
            <span className="font-semibold text-gray-700 dark:text-gray-200">
              {closing === null ? 'Total of everything below' : 'Balance now'}
            </span>
            <span className="font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {fmt(closing === null ? movement : closing)}
            </span>
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing logged with {source.name} yet.
        </p>
      ) : (
        <div className="max-h-[55svh] space-y-0.5 overflow-y-auto">
          {rows.slice(0, 150).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-gray-700 dark:text-gray-200 truncate">
                  {r.kind === 'recharge' && '🔋 '}
                  {r.kind === 'transfer' && '💸 '}
                  {r.kind === 'office' && '💼 '}
                  {r.kind === 'pass' && '🎫 '}
                  {r.kind === 'withdrawal' && '🏧 '}
                  {r.kind === 'adjust' && (r.amount >= 0 ? '➕ ' : '➖ ')}
                  {r.label}
                </span>
                <span className="block text-[10px] text-gray-500 dark:text-gray-400">
                  {r.date?.toLocaleDateString()}
                  {!counts(r) && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {' '}
                      · not counted (before {since?.toLocaleDateString()})
                    </span>
                  )}
                </span>
              </span>
              <span
                className={`shrink-0 text-xs font-semibold tabular-nums ${
                  r.amount >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {r.amount >= 0 ? '+' : '−'}
                {fmt(Math.abs(r.amount))}
              </span>
              {/* Added it by mistake? One tap puts everything back. */}
              {r.kind === 'adjust' && onUndoEntry && (
                <button
                  type="button"
                  onClick={() => onUndoEntry(r.recordId)}
                  aria-label="Delete this entry"
                  className="shrink-0 p-1 text-gray-400 transition-transform active:scale-90 hover:text-red-500"
                >
                  <Trash2 size={13} />
                </button>
              )}
              {r.kind === 'recharge' && onUndo && (
                <button
                  type="button"
                  onClick={() => onUndo(r.recordId)}
                  aria-label="Undo this top-up"
                  className="shrink-0 p-1 text-gray-400 transition-transform active:scale-90 hover:text-red-500"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {rows.length > 150 && (
            <p className="pt-2 text-center text-[11px] text-gray-400 dark:text-gray-500">
              Showing the latest 150 — export from History for the rest
            </p>
          )}
        </div>
      )}
            {skipped > 0 && (
        <p className="rounded-xl bg-amber-50 p-2.5 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          {skipped} record{skipped === 1 ? '' : 's'} sit before this balance's starting point (
          {since?.toLocaleDateString()}), so they don't move the number — the balance restarted from
          the figure you typed.{' '}
          {isCard
            ? `Delete the "set exact balance" top-up on ${since?.toLocaleDateString()} if they should count again.`
            : 'Set "Counting from" to an earlier date in Settings if they should count.'}
        </p>
      )}
      {rows.length > 0 && (
        <p className="border-t border-gray-200 pt-2 text-[11px] text-gray-400 dark:border-white/10 dark:text-gray-500">
          🔋 Top-ups and ➕/➖ hand-logged entries can be deleted here — both sides go back at once.
          Expenses and income are removed in{' '}
          <Link to="/history" className="text-indigo-500 underline">
            History
          </Link>
          , transfers in{' '}
          <Link to="/transfers" className="text-indigo-500 underline">
            Transfers
          </Link>
          , so their linked records (commute trips, group ledgers, friend debts) go with them.
        </p>
      )}
    </BottomSheet>
  )
}
