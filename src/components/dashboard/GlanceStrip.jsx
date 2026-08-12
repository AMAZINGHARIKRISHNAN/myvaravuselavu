import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCollection } from '../../hooks/useCollection'
import { formatJPY } from '../../lib/format'
import { cardBalance } from '../../lib/wallet'

// One row where three cards used to be.
//
// Commute, Shopping and Notes each had a full-width card on the Dashboard, and
// each was mostly a doorway — the More sheet reaches all three now, so the
// doorway is redundant. What was NOT redundant is the handful of numbers they
// carried: a transit card about to be declined at the gate, a refund that has
// not landed, a reminder you wrote and forgot. Deleting the cards would have
// thrown those away with the chrome.
//
// So the chrome goes and the numbers stay, as chips that only appear when they
// have something to say. Nothing to report means nothing rendered — this strip
// is silent on a quiet day rather than being three cards saying "nothing".
//
// Every collection here is already subscribed elsewhere on this screen, so the
// shared listener registry means these chips cost no extra Firestore reads.

const LOW_PASMO = 560 // less than one commute day left

function Chip({ to, emoji, value, label, tone = 'plain' }) {
  const tones = {
    plain: 'text-gray-900 dark:text-gray-100',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-red-500 dark:text-red-400',
  }
  return (
    <Link
      to={to}
      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-2 transition-transform active:scale-[0.98] touch-manipulation hover:bg-gray-100/60 dark:hover:bg-white/5"
    >
      <span className="text-base" aria-hidden="true">
        {emoji}
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-semibold tabular-nums ${tones[tone]}`}>{value}</span>
        <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{label}</span>
      </span>
    </Link>
  )
}

export default function GlanceStrip() {
  const recharges = useCollection('pasmoRecharges')
  const expenses = useCollection('expenses')
  const officeItems = useCollection('officeReimbursements')
  const passes = useCollection('commutePasses')
  const orders = useCollection('onlineOrders')
  const notes = useCollection('notes')

  const pasmo = useMemo(() => {
    if (!recharges.data.some((r) => (r.card || 'Pasmo') === 'Pasmo')) return null
    return cardBalance('Pasmo', recharges.data, expenses.data, officeItems.data, passes.data)
  }, [recharges.data, expenses.data, officeItems.data, passes.data])

  // Money a seller owes back that has not arrived — the thing worth chasing.
  const pendingRefunds = useMemo(
    () =>
      orders.data.reduce(
        (s, o) => s + (o.status === 'returned' && o.refundStatus === 'pending' ? o.refundMoney || 0 : 0),
        0
      ),
    [orders.data]
  )

  const openNotes = useMemo(() => notes.data.filter((n) => !n.done), [notes.data])
  // Pinned wins, else the newest — the same rule the old card used.
  const topNote = openNotes.find((n) => n.pinned) || openNotes[0]

  const chips = []
  if (pasmo !== null) {
    chips.push(
      <Chip
        key="pasmo"
        to="/commute"
        emoji="💳"
        value={formatJPY(pasmo)}
        label={pasmo < 0 ? 'Pasmo — below zero' : pasmo < LOW_PASMO ? 'Pasmo — recharge soon' : 'Pasmo balance'}
        tone={pasmo < 0 ? 'bad' : pasmo < LOW_PASMO ? 'warn' : 'plain'}
      />
    )
  }
  if (pendingRefunds > 0) {
    chips.push(
      <Chip
        key="refund"
        to="/shopping"
        emoji="⏳"
        value={formatJPY(pendingRefunds)}
        label="refund on the way"
        tone="warn"
      />
    )
  }
  if (openNotes.length > 0) {
    chips.push(
      <Chip
        key="notes"
        to="/notes"
        emoji="📝"
        value={`${openNotes.length} note${openNotes.length === 1 ? '' : 's'}`}
        label={topNote ? `${topNote.pinned ? '📌 ' : ''}${topNote.text}` : 'open'}
      />
    )
  }

  if (chips.length === 0) return null

  return (
    <div className="card flex flex-wrap items-stretch gap-1 p-1.5">{chips}</div>
  )
}
