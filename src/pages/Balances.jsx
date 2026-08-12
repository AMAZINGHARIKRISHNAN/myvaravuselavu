import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Landmark, Plus } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { useAccountBalances } from '../hooks/useAccountBalances'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../context/ToastContext'
import { formatByCountry, formatJPY, toDateInputValue, parseDateInput } from '../lib/format'
import { PREPAID_CARDS, cardBalance, cardAnchor } from '../lib/wallet'
import { fundingSources } from '../lib/money'
import { cutoffFor as cutoffForAccount } from '../lib/balances'
import { cashPosition } from '../lib/cash'
import BottomSheet from '../components/ui/BottomSheet'
import Skeleton from '../components/ui/Skeleton'
import SourceHistorySheet from '../components/wallet/SourceHistorySheet'

const FLAGS = { JP: '🇯🇵', IN: '🇮🇳' }

// The wallet: every balance in one place — bank accounts, prepaid cards
// (Pasmo/Edenred), plus cash — and tap any of them for the full transaction
// history that explains the number.
export default function Balances() {
  const { balances, hasTracked, loading: banksLoading } = useAccountBalances()
  const { settings } = useSettings()
  const recharges = useCollection('pasmoRecharges')
  const expenses = useCollection('expenses')
  const income = useCollection('income')
  const transfers = useCollection('transfers')
  const cashCounts = useCollection('cashCounts')
  const officeItems = useCollection('officeReimbursements')
  const passes = useCollection('commutePasses')
  const withdrawals = useCollection('withdrawals')
  const accountEntries = useCollection('accountEntries')
  const { toast } = useToast()

  // Undoing a top-up: one delete reverses both sides at once, because the card
  // balance AND the paying account's balance are both derived from this single
  // record — nothing is stored that would need unwinding separately. Balances
  // move when the undo window closes, so every number turns over together.
  const { pendingIds, requestDelete } = useUndoableDelete(recharges.remove, 'Top-up')
  // Same deal for a hand-logged credit/debit: it's self-contained, so removing
  // it puts the balance back exactly where it was.
  const entryUndo = useUndoableDelete(accountEntries.remove, 'Entry')

  // Cash per currency: yen and rupees are counted separately, so they get a
  // row each rather than one number that quietly mixes them.
  const cashRows = ['JP', 'IN']
    .map((country) => ({
      country,
      ...cashPosition({
        counts: cashCounts.data,
        expenses: expenses.data,
        income: income.data,
        recharges: recharges.data,
        officeItems: officeItems.data,
        passes: passes.data,
        withdrawals: withdrawals.data,
        accountEntries: accountEntries.data,
        country,
      }),
    }))
    // Yen always shows (it's the home currency and the count prompt lives
    // there); rupee cash appears once there's something to show.
    .filter((c) => c.country === 'JP' || c.hasCount)

  const [historyOf, setHistoryOf] = useState(null) // {name, country}
  const [topUpCard, setTopUpCard] = useState(null) // {name, balance}

  const loading = banksLoading || recharges.loading || expenses.loading || cashCounts.loading || officeItems.loading || passes.loading || withdrawals.loading || accountEntries.loading

  const accounts = settings?.accounts || []
  const untracked = accounts.filter((a) => !balances.some((b) => b.id === a.id))

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const rowClass =
    'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 touch-manipulation dark:hover:bg-neutral-800/50 dark:active:bg-neutral-800'

  return (
    <div className="space-y-4 pb-16 lg:mx-auto lg:max-w-2xl lg:pb-0">
      <div className="card p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">👛 All balances</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Tap anything to see every transaction behind its number.
          </p>
        </div>
        {/* Books drifted from reality? Fix it properly, line by line. */}
        <Link
          to="/reconcile"
          className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-100/70 px-3 py-2.5 text-xs font-medium text-gray-700 transition-transform active:scale-[0.99] touch-manipulation dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-200"
        >
          <span>🔍 Check against your bank — log anything that's missing</span>
          <ChevronRight size={14} className="shrink-0 text-gray-400" aria-hidden="true" />
        </Link>
      </div>

      {/* ---- Bank accounts ---- */}
      <div className="card divide-y divide-gray-200 overflow-hidden dark:divide-white/5">
        {balances.map((a) => (
          <button key={a.id} type="button" onClick={() => setHistoryOf({ name: a.label, country: a.country, since: cutoffForAccount(a), opening: a.openingBalance ?? 0 })} className={rowClass}>
            <span aria-hidden="true" className="text-lg">{FLAGS[a.country] || '🏦'}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{a.label}</span>
              <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                {a.fromZero ? 'From zero · every entry counted' : 'Bank account'}
              </span>
            </span>
            <span
              className={`shrink-0 text-sm font-bold tabular-nums ${
                a.balance < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {formatByCountry(a.balance, a.country)}
            </span>
            <ChevronRight size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
          </button>
        ))}
        {untracked.map((a) => (
          <Link key={a.id} to="/settings" className={rowClass}>
            <span aria-hidden="true" className="text-lg">{FLAGS[a.country] || '🏦'}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{a.label}</span>
              <span className="block text-[11px] text-amber-600 dark:text-amber-400">
                Set its current balance in Settings to start tracking
              </span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
          </Link>
        ))}
        {accounts.length === 0 && (
          <Link to="/settings" className={rowClass}>
            <span className="icon-tile"><Landmark size={15} aria-hidden="true" /></span>
            <span className="flex-1 text-sm text-gray-600 dark:text-gray-300">
              Add your bank accounts in Settings
            </span>
            <ChevronRight size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* ---- Prepaid cards: balance + top-up ---- */}
      <div className="card divide-y divide-gray-200 overflow-hidden dark:divide-white/5">
        {PREPAID_CARDS.map((card) => {
          const balance = cardBalance(card.name, recharges.data, expenses.data, officeItems.data, passes.data)
          return (
            <div key={card.name} className="flex items-center">
              <button
                type="button"
                // The card's own reconcile point, so the sheet can mark what
                // the balance skips and its total lands on the same figure.
                onClick={() => {
                  const anchor = cardAnchor(card.name, recharges.data)
                  setHistoryOf({
                    name: card.name,
                    country: 'JP',
                    since: anchor?.since ?? null,
                    opening: anchor?.opening ?? 0,
                  })
                }}
                className={`${rowClass} min-w-0 flex-1`}
              >
                <span aria-hidden="true" className="text-lg">{card.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">{card.name}</span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                    {card.company ? '¥10,000 from company every 16th' : 'Prepaid card'}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-sm font-bold tabular-nums ${
                    balance < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
                  }`}
                >
                  {formatJPY(balance)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTopUpCard({ name: card.name, balance })}
                aria-label={`Top up ${card.name}`}
                className="mr-3 flex tap-target h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition-transform active:scale-90 touch-manipulation dark:bg-indigo-500"
              >
                <Plus size={15} />
              </button>
            </div>
          )
        })}
        {/* Physical cash: the number comes from the last time you counted the
            notes and coins, carried forward by cash spending since. One row
            per currency — ¥ and ₹ are never mixed into a single total. */}
        {cashRows.map((cash) => (
          <div key={cash.country} className="flex items-center">
            <Link to="/cash" className={`${rowClass} min-w-0 flex-1`}>
              <span aria-hidden="true" className="text-lg">💵</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">
                  Cash {FLAGS[cash.country]}
                </span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                  {cash.hasCount
                    ? `${cash.stashes.length} place${cash.stashes.length === 1 ? '' : 's'} · counted ${cash.countedAt?.toLocaleDateString()}`
                    : 'Tap to count your notes and coins'}
                </span>
              </span>
              {cash.hasCount && (
                <span
                  className={`shrink-0 text-sm font-bold tabular-nums ${
                    cash.expected < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
                  }`}
                >
                  {formatByCountry(cash.expected, cash.country)}
                </span>
              )}
              <ChevronRight size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={() => setHistoryOf({ name: 'Cash', country: cash.country })}
              aria-label={`Cash history ${cash.country}`}
              className="mr-3 shrink-0 rounded-full border border-gray-300/60 bg-gray-100 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition-transform active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-800 dark:text-gray-300"
            >
              History
            </button>
          </div>
        ))}
      </div>

      {!hasTracked && accounts.length > 0 && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          Bank balances come from the opening balance you set in Settings, moved by every logged
          expense, income and transfer.
        </p>
      )}

      {historyOf && (
        <SourceHistorySheet
          source={historyOf}
          data={{
            expenses: expenses.data,
            income: income.data,
            transfers: transfers.data,
            recharges: recharges.data.filter((r) => !pendingIds.has(r.id)),
            officeItems: officeItems.data,
            passes: passes.data,
            withdrawals: withdrawals.data,
            accountEntries: accountEntries.data.filter((r) => !entryUndo.pendingIds.has(r.id)),
            country: historyOf.country,
          }}
          onUndo={requestDelete}
          onUndoEntry={entryUndo.requestDelete}
          onClose={() => setHistoryOf(null)}
        />
      )}
      {topUpCard && (
        <TopUpSheet
          card={topUpCard.name}
          balance={topUpCard.balance}
          onAdd={async (payload, message) => {
            await recharges.add(payload)
            toast(message)
          }}
          onClose={() => setTopUpCard(null)}
        />
      )}
    </div>
  )
}

// Load money onto a prepaid card. "Paid from" moves the money properly:
// a top-up from a bank account deducts that account and credits the card
// (bank → card). It is never an expense — purchases made WITH the card are
// the real spending, so nothing double-counts.
function TopUpSheet({ card, balance = 0, onAdd, onClose }) {
  const { settings } = useSettings()
  // A card holds yen, so only yen can be loaded onto it. Listing every
  // account here let a ¥3,000 top-up be funded from an Indian bank: ₹3,000 out,
  // ¥3,000 in, and the difference was money that never existed.
  const sources = fundingSources(settings?.accounts, 'JP')
  // Company cards (Edenred) are loaded by the employer — never from the
  // user's own money, so there's no "paid from" and nothing gets deducted.
  const isCompanyCard = PREPAID_CARDS.find((c) => c.name === card)?.company
  // 'add' loads money on; 'set' types what the card ACTUALLY shows and the
  // app books the difference as a correction — for starting fresh or when
  // tracking drifted from reality.
  const [mode, setMode] = useState('add')
  const [amount, setAmount] = useState('')
  const [paidFrom, setPaidFrom] = useState('Cash')
  const [date, setDate] = useState(toDateInputValue())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const amountNum = parseFloat(amount) || 0
  const delta = mode === 'set' ? amountNum - balance : amountNum

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (mode === 'add' && amountNum <= 0) {
      setError('Enter the top-up amount.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onAdd(
        {
          card,
          amount: delta, // corrections may be negative — the math handles it
          // Reconcile point: balance restarts from this number and ignores
          // everything dated earlier — backfilled old logs can't deduct.
          setTo: mode === 'set' ? amountNum : null,
          // Company cards spend none of your money, and a reconcile only fixes
          // the card — neither takes anything from an account. 'Cash' is kept
          // as-is so the cash count knows those notes left your pocket.
          paidFrom: isCompanyCard || mode === 'set' ? null : paidFrom,
          date: parseDateInput(date),
          note: note.trim() || (mode === 'set' ? `Balance set to ${formatJPY(amountNum)}` : ''),
        },
        mode === 'set'
          ? `🎯 ${card} balance set to ${formatJPY(amountNum)}`
          : `${PREPAID_CARDS.find((c) => c.name === card)?.emoji || '💳'} ${formatJPY(amountNum)} loaded onto ${card}`
      )
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={`Top up ${card}`}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Two ways in: load money on, or declare what the card really holds */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { key: 'add', label: '+ Add amount' },
          { key: 'set', label: '🎯 Set exact balance' },
        ].map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              setMode(m.key)
              setError('')
            }}
            className={`rounded-xl border py-2.5 text-xs font-semibold transition-transform active:scale-95 touch-manipulation ${
              mode === m.key
                ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                : 'border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'set' && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          App currently shows {formatJPY(balance)}. Type what the card really holds — the balance
          restarts from that number, and anything dated before today (like old logs you backfill)
          will never deduct from it.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {[1000, 2000, 3000, 5000, 10000].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setAmount(String(v))}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
              parseFloat(amount) === v
                ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
            }`}
          >
            {formatJPY(v)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          {mode === 'set' ? 'Balance on the card (¥)' : 'Amount (¥)'}
          <input type="number" step="any" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
      </div>
      {mode === 'set' && amountNum > 0 && delta !== 0 && (
        <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
          Correction: {delta > 0 ? '+' : '−'}
          {formatJPY(Math.abs(delta))} → balance becomes {formatJPY(amountNum)}
        </p>
      )}
      {mode !== 'set' && !isCompanyCard && (
        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>Paid from (that account's balance goes down)</p>
          <div className="flex flex-wrap gap-2">
            {sources.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setPaidFrom(label)}
                className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                  paidFrom === label
                    ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                    : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
      </label>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        {mode === 'set'
          ? 'A reconcile only fixes this balance — it never touches your accounts, expenses or income, and old-dated records stay ignored.'
          : isCompanyCard
            ? `${card} is loaded by your company — the monthly ¥10,000 adds itself on the 16th, so use this only for corrections or extra credits. Nothing is taken from your own money.`
            : `Money moves ${paidFrom === 'Cash' ? 'from cash' : `out of ${paidFrom}`} onto ${card}. Spending happens later, when you pay with ${card} — so this top-up never double-counts.`}
      </p>
      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : mode === 'set' ? `Set ${card} balance` : `Add to ${card}`}
      </button>
    </BottomSheet>
  )
}
