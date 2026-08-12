import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, Plus, Trash2, Landmark, Scale } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../context/ToastContext'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { formatByCountry, toDateInputValue, parseDateInput, toDate } from '../lib/format'
import {
  DENOMINATIONS,
  DEFAULT_STASHES,
  stashEmoji,
  countTotal,
  pieceCount,
  cashPosition,
  cashLedger,
  recountDrift,
  denomRows,
} from '../lib/cash'
import BottomSheet from '../components/ui/BottomSheet'
import Skeleton from '../components/ui/Skeleton'

// Physical cash: count the notes and coins in each place you keep them, and
// the app carries that number forward as you log cash spending.
export default function Cash() {
  const counts = useCollection('cashCounts')
  const expenses = useCollection('expenses')
  const income = useCollection('income')
  const recharges = useCollection('pasmoRecharges')
  const officeItems = useCollection('officeReimbursements')
  const passes = useCollection('commutePasses')
  const withdrawals = useCollection('withdrawals')
  const accountEntries = useCollection('accountEntries')
  const { settings } = useSettings()
  const { toast } = useToast()
  const { pendingIds, requestDelete } = useUndoableDelete(counts.remove, 'Cash count')
  // Deleting a withdrawal reverses both sides — the account balance and the
  // cash total go back — because both are derived from this one record.
  const wUndo = useUndoableDelete(withdrawals.remove, 'Withdrawal')

  const [country, setCountry] = useState('JP')
  const [counting, setCounting] = useState(null) // {stash} | null
  const [openStash, setOpenStash] = useState(null)
  const [tallying, setTallying] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)

  const loading =
    counts.loading ||
    expenses.loading ||
    income.loading ||
    recharges.loading ||
    officeItems.loading ||
    passes.loading ||
    withdrawals.loading ||
    accountEntries.loading

  // A count awaiting its undo window is treated as already gone, so the
  // totals move the moment you tap delete.
  const liveCounts = useMemo(
    () => counts.data.filter((c) => !pendingIds.has(c.id)),
    [counts.data, pendingIds]
  )
  // A withdrawal awaiting its undo window is treated as already gone, so the
  // balance restores the moment you tap delete.
  const liveWithdrawals = useMemo(
    () => withdrawals.data.filter((w) => !wUndo.pendingIds.has(w.id)),
    [withdrawals.data, wUndo.pendingIds]
  )

  const position = useMemo(
    () =>
      cashPosition({
        counts: liveCounts,
        expenses: expenses.data,
        income: income.data,
        recharges: recharges.data,
        officeItems: officeItems.data,
        passes: passes.data,
        withdrawals: liveWithdrawals,
        accountEntries: accountEntries.data,
        country,
      }),
    [liveCounts, expenses.data, income.data, recharges.data, officeItems.data, passes.data, liveWithdrawals, accountEntries.data, country]
  )

  // The itemised accounting behind "expected": where the cash went since the
  // last count. Its signed total equals expected − counted, by construction.
  const ledger = useMemo(
    () =>
      cashLedger({
        counts: liveCounts,
        expenses: expenses.data,
        income: income.data,
        recharges: recharges.data,
        officeItems: officeItems.data,
        passes: passes.data,
        withdrawals: liveWithdrawals,
        accountEntries: accountEntries.data,
        country,
      }),
    [liveCounts, expenses.data, income.data, recharges.data, officeItems.data, passes.data, liveWithdrawals, accountEntries.data, country]
  )

  // Accounts you can withdraw from, in this currency (JP or IN).
  const withdrawableAccounts = (settings?.accounts || []).filter(
    (a) => (a.country || 'JP') === country
  )

  const fmt = (v) => formatByCountry(v, country)
  // Every stash name ever used, so a place you invented once stays one tap away.
  const knownStashes = useMemo(() => {
    const names = new Set(DEFAULT_STASHES.map((s) => s.name))
    for (const c of counts.data) if (c.stash) names.add(c.stash.trim())
    return [...names]
  }, [counts.data])

  const history = liveCounts.filter((c) => (c.country || 'JP') === country)
  const movement = position.expected - position.counted

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-16 lg:mx-auto lg:max-w-2xl lg:pb-0">
      <div className="flex items-center gap-2">
        <Link
          to="/balances"
          className="flex tap-target h-8 w-8 items-center justify-center rounded-full border border-gray-300/60 bg-gray-100 text-gray-500 transition-transform active:scale-90 dark:border-transparent dark:bg-neutral-800 dark:text-gray-400"
          aria-label="Back to balances"
        >
          <ChevronLeft size={16} />
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
          💵 Cash on hand
        </h1>
        {/* Yen and rupee cash are counted separately — different notes, and
            a rupee can't come out of your pocket in Japan. */}
        <div className="flex gap-1">
          {['JP', 'IN'].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCountry(c)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all active:scale-95 touch-manipulation ${
                country === c
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                  : 'border border-gray-300/60 bg-gray-100 text-gray-600 dark:border-transparent dark:bg-neutral-800 dark:text-gray-300'
              }`}
            >
              {c === 'JP' ? '🇯🇵 ¥' : '🇮🇳 ₹'}
            </button>
          ))}
        </div>
      </div>

      {/* ---- The headline number ---- */}
      <div className="card p-4 space-y-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {position.hasCount ? 'You should be holding' : 'Nothing counted yet'}
        </p>
        <p className="text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {fmt(position.expected)}
        </p>
        {position.hasCount ? (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Counted {fmt(position.counted)} on {position.countedAt?.toLocaleDateString()}
            {movement !== 0 && (
              <>
                {' '}
                ·{' '}
                {position.received > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    +{fmt(position.received)} in{' '}
                  </span>
                )}
                {position.spent > 0 && (
                  <span className="text-red-500 dark:text-red-400">
                    −{fmt(position.spent)} spent{' '}
                  </span>
                )}
                {position.loaded > 0 && (
                  <span className="text-red-500 dark:text-red-400">
                    −{fmt(position.loaded)} onto cards{' '}
                  </span>
                )}
                {position.fronted > 0 && (
                  <span className="text-red-500 dark:text-red-400">
                    −{fmt(position.fronted)} fronted for office{' '}
                  </span>
                )}
                {position.passCash > 0 && (
                  <span className="text-red-500 dark:text-red-400">
                    −{fmt(position.passCash)} commuter pass{' '}
                  </span>
                )}
                {position.withdrawn > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    +{fmt(position.withdrawn)} withdrawn{' '}
                  </span>
                )}
                since
              </>
            )}
          </p>
        ) : (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Count what's in your wallet, locker or drawer — the app keeps it up to date from there
            as you log cash spending.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setCounting({ stash: '' })}
            className="btn-primary flex items-center justify-center gap-1.5 py-2.5 text-sm"
          >
            <Plus size={15} /> Count
          </button>
          {/* Verify hand vs books, and resolve any gap so it tallies */}
          <button
            type="button"
            onClick={() => setTallying(true)}
            disabled={!position.hasCount}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-300/60 bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 transition-transform active:scale-95 touch-manipulation disabled:opacity-40 dark:border-transparent dark:bg-neutral-800 dark:text-gray-200"
          >
            <Scale size={15} /> Tally
          </button>
          <button
            type="button"
            onClick={() => setWithdrawing(true)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-300/60 bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 transition-transform active:scale-95 touch-manipulation dark:border-transparent dark:bg-neutral-800 dark:text-gray-200"
          >
            <Landmark size={15} /> Withdraw
          </button>
        </div>
      </div>

      {/* ---- Where your cash went: the accounting behind "expected" ---- */}
      {ledger.length > 0 && (
        <div className="card p-4 space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold text-gray-900 dark:text-gray-100">
              Where it went since your count
            </h2>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {ledger.length} move{ledger.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {ledger.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1.5">
                <span aria-hidden="true" className="text-sm">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-gray-700 dark:text-gray-200">
                    {r.label}
                    {r.place && <span className="text-gray-400"> · 🏪 {r.place}</span>}
                  </span>
                  <span className="block text-[10px] text-gray-500 dark:text-gray-400">
                    {r.date?.toLocaleDateString()}
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- One row per place the money sits ---- */}
      {position.stashes.length > 0 && (
        <div className="card divide-y divide-gray-200 overflow-hidden dark:divide-white/5">
          {position.stashes.map((s) => {
            const open = openStash === s.stash
            const stale = s.date && Date.now() - s.date.getTime() > 30 * 864e5
            return (
              <div key={s.stash}>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setOpenStash(open ? null : s.stash)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 touch-manipulation dark:hover:bg-neutral-800/50"
                  >
                    <span aria-hidden="true" className="text-lg">
                      {stashEmoji(s.stash)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                        {s.stash}
                      </span>
                      <span
                        className={`block text-[11px] ${
                          stale
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {s.pieces} note{s.pieces === 1 ? '' : 's'} & coins · counted{' '}
                        {s.date?.toLocaleDateString()}
                        {stale ? ' — worth a recount' : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
                      {fmt(s.total)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCounting({ stash: s.stash })}
                    aria-label={`Recount ${s.stash}`}
                    className="mr-3 shrink-0 rounded-full bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-transform active:scale-90 touch-manipulation dark:bg-indigo-500"
                  >
                    Recount
                  </button>
                </div>

                {/* The actual breakdown — what notes and coins make that number */}
                {open && (
                  <div className="space-y-1 bg-gray-50 px-4 py-3 dark:bg-neutral-800/30">
                    {denomRows(s.denoms, country).map((r) => (
                      <div key={r.value} className="flex items-center gap-2 text-xs">
                        <span className="w-20 shrink-0 tabular-nums text-gray-700 dark:text-gray-200">
                          {fmt(r.value)}
                        </span>
                        <span className="w-10 shrink-0 text-gray-400">× {r.qty}</span>
                        <span className="flex-1 text-right tabular-nums text-gray-600 dark:text-gray-300">
                          {fmt(r.subtotal)}
                        </span>
                      </div>
                    ))}
                    {s.note && (
                      <p className="pt-1 text-[11px] italic text-gray-500 dark:text-gray-400">
                        {s.note}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ---- Past counts, so a drift is traceable ---- */}
      {history.length > 0 && (
        <div className="card p-4 space-y-2">
          <h2 className="text-xs font-semibold text-gray-900 dark:text-gray-100">Count history</h2>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {history.slice(0, 60).map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-gray-700 dark:text-gray-200">
                    {stashEmoji(c.stash)} {c.stash || 'Wallet'}
                    {c.note ? ` · ${c.note}` : ''}
                  </span>
                  <span className="block text-[10px] text-gray-500 dark:text-gray-400">
                    {toDate(c.date)?.toLocaleDateString()} · {pieceCount(c.denoms)} pieces
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  {fmt(countTotal(c.denoms))}
                </span>
                <button
                  type="button"
                  onClick={() => requestDelete(c.id)}
                  aria-label="Delete count"
                  className="shrink-0 p-1 text-gray-400 transition-transform active:scale-90 hover:text-red-500"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent withdrawals for this currency — deletable, both sides revert */}
      {(() => {
        const rows = liveWithdrawals
          .filter((w) => (w.country || 'JP') === country)
          .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))
        if (rows.length === 0) return null
        return (
          <div className="card p-4 space-y-2">
            <h2 className="text-xs font-semibold text-gray-900 dark:text-gray-100">Withdrawals</h2>
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {rows.slice(0, 40).map((w) => (
                <div key={w.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-gray-700 dark:text-gray-200">
                      🏧 {w.account || 'Bank'} → cash
                      {w.note ? ` · ${w.note}` : ''}
                    </span>
                    <span className="block text-[10px] text-gray-500 dark:text-gray-400">
                      {toDate(w.date)?.toLocaleDateString()}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    +{fmt(w.amount || 0)}
                  </span>
                  <button
                    type="button"
                    onClick={() => wUndo.requestDelete(w.id)}
                    aria-label="Delete withdrawal"
                    className="shrink-0 p-1 text-gray-400 transition-transform active:scale-90 hover:text-red-500"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        A count is a fresh start: anything you log with a date before it is treated as already
        spent from that pile, so backfilling old receipts never eats your cash twice.
      </p>

      {counting && (
        <CountSheet
          country={country}
          initialStash={counting.stash}
          knownStashes={knownStashes}
          position={position}
          onSave={async (payload, message) => {
            await counts.add(payload)
            toast(message)
          }}
          onClose={() => setCounting(null)}
        />
      )}

      {withdrawing && (
        <WithdrawSheet
          country={country}
          accounts={withdrawableAccounts}
          onSave={async (payload, message) => {
            await withdrawals.add(payload)
            toast(message)
          }}
          onClose={() => setWithdrawing(false)}
        />
      )}

      {tallying && (
        <TallySheet
          country={country}
          expected={position.expected}
          ledger={ledger}
          onBookExpense={async (amt, note) => {
            await expenses.add({
              amount: amt,
              category: 'Other',
              country,
              paymentMethod: 'Cash',
              store: '',
              note: note || 'Cash reconcile — untracked spending',
              date: new Date(),
            })
            toast(`✓ ${fmt(amt)} logged as cash spending — now it tallies`)
          }}
          onBookIncome={async (amt, note) => {
            await income.add({
              amount: amt,
              source: 'Cash found',
              gross: null,
              net: null,
              account: 'Cash',
              country,
              note: note || 'Cash reconcile — extra found',
              date: new Date(),
            })
            toast(`✓ ${fmt(amt)} logged as cash in — now it tallies`)
          }}
          onClose={() => setTallying(false)}
        />
      )}
    </div>
  )
}

// Reconcile: you enter what's actually in your hand; if it doesn't match what
// the app expects, it shows the gap and helps you resolve it so everything
// tallies — usually spending you forgot to log.
function TallySheet({ country, expected, ledger, onBookExpense, onBookIncome, onClose }) {
  const [actual, setActual] = useState('')
  const [saving, setSaving] = useState(false)
  const fmt = (v) => formatByCountry(v, country)

  const hasInput = actual !== ''
  const actualNum = parseFloat(actual) || 0
  const gap = expected - actualNum // >0 = short (spent more than logged); <0 = extra
  const tallies = hasInput && Math.abs(gap) < 1
  const short = gap >= 1
  const surplus = gap <= -1
  // Rupee cash gets no "found income" path (income isn't currency-scoped here),
  // so a surplus there is resolved by a recount instead.
  const canBookSurplus = country === 'JP'

  const resolve = async (fn) => {
    setSaving(true)
    try {
      await fn()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet onClose={onClose} title="Tally your cash">
      <div className="rounded-xl bg-gray-100/80 px-3 py-2.5 dark:bg-neutral-800/50">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">The app expects</span>
          <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {fmt(expected)}
          </span>
        </div>
      </div>

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        How much do you actually have in hand right now?
        <input
          type="number"
          step="any"
          inputMode="numeric"
          autoFocus
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          className="input text-lg"
          placeholder={String(Math.round(expected))}
        />
      </label>

      {tallies && (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          ✓ Everything tallies — {fmt(actualNum)} in hand, all accounted for.
        </p>
      )}

      {short && (
        <div className="space-y-2.5">
          <p className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            ⚠ You have {fmt(gap)} less than expected. That's usually cash you spent but didn't
            log. Check the list below — recognise anything missing?
          </p>
          {/* The accounting, right here, to jog the memory */}
          {ledger.length > 0 && (
            <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-neutral-700">
              {ledger.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-gray-600 dark:text-gray-300">
                    {r.icon} {r.label}
                    {r.place && ` · ${r.place}`}
                  </span>
                  <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
                    {r.amount >= 0 ? '+' : '−'}
                    {fmt(Math.abs(r.amount))}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => resolve(() => onBookExpense(gap))}
            className="btn-primary min-h-11 w-full text-sm"
          >
            Log the {fmt(gap)} as spending — make it tally
          </button>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Or if you just miscounted, close this and tap <span className="font-medium">Count</span>{' '}
            to set the real amount as a fresh starting point.
          </p>
        </div>
      )}

      {surplus && (
        <div className="space-y-2.5">
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
            You have {fmt(-gap)} more than expected — cash you received but didn't log?
          </p>
          {canBookSurplus ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => resolve(() => onBookIncome(-gap))}
              className="btn-primary min-h-11 w-full text-sm"
            >
              Log the {fmt(-gap)} as cash received — make it tally
            </button>
          ) : (
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Close this and tap <span className="font-medium">Count</span> to set the real amount.
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  )
}

// Log cash pulled out of a bank account: the account balance goes down, the
// notes in your pocket go up. Not an expense — just money changing form.
function WithdrawSheet({ country, accounts, onSave, onClose }) {
  const [account, setAccount] = useState(accounts[0]?.label ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(toDateInputValue())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fmt = (v) => formatByCountry(v, country)
  const amountNum = parseFloat(amount) || 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!account) {
      setError('Add a bank account in Settings first.')
      return
    }
    if (amountNum <= 0) {
      setError('Enter how much you took out.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(
        {
          account,
          amount: amountNum,
          country,
          date: parseDateInput(date),
          note: note.trim(),
        },
        `🏧 ${fmt(amountNum)} withdrawn from ${account} → cash`
      )
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title="Withdraw from bank">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {accounts.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No {country === 'JP' ? 'Japanese' : 'Indian'} account to withdraw from yet — add one in
          Settings.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className="text-xs text-gray-500 dark:text-gray-400">From account</p>
            <div className="flex flex-wrap gap-2">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAccount(a.label)}
                  className={`min-h-9 rounded-full px-3.5 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                    account === a.label
                      ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                      : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
              Amount ({country === 'JP' ? '¥' : '₹'})
              <input
                type="number"
                step="any"
                required
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input"
              />
            </label>
            <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
            </label>
          </div>

          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
          </label>

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            {account ? `${account} goes down by ${fmt(amountNum)}` : 'The account'} and your cash on
            hand goes up by the same — it's your own money, never counted as income or spending.
          </p>

          <button type="submit" disabled={saving} className="btn-primary min-h-12 w-full text-sm">
            {saving ? 'Saving…' : `Log withdrawal${amountNum > 0 ? ` · ${fmt(amountNum)}` : ''}`}
          </button>
        </>
      )}
    </BottomSheet>
  )
}

// The counting screen: one row per denomination, tap the steppers or type the
// quantity, and the total adds itself up as you go.
function CountSheet({ country, initialStash, knownStashes, position, onSave, onClose }) {
  const [stash, setStash] = useState(initialStash || 'Wallet')
  const [denoms, setDenoms] = useState({})
  const [date, setDate] = useState(toDateInputValue())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fmt = (v) => formatByCountry(v, country)
  const total = countTotal(denoms)
  const pieces = pieceCount(denoms)
  // How this count compares to the last one of the same stash — a nudge, never
  // an automatic correction.
  const drift = recountDrift({ stash, denoms, position })

  const setQty = (value, qty) =>
    setDenoms((d) => ({ ...d, [value]: qty === '' ? '' : Math.max(0, Number(qty) || 0) }))
  const bump = (value, by) => {
    if (navigator.vibrate) navigator.vibrate(5)
    setDenoms((d) => ({ ...d, [value]: Math.max(0, (Number(d[value]) || 0) + by) }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!stash.trim()) {
      setError('Name the place this cash is kept.')
      return
    }
    setSaving(true)
    setError('')
    try {
      // Store only what's actually held — a wall of zeros helps nobody.
      const clean = {}
      for (const [v, q] of Object.entries(denoms)) {
        const n = Number(q) || 0
        if (n > 0) clean[v] = n
      }
      await onSave(
        {
          stash: stash.trim(),
          country,
          denoms: clean,
          total, // stored alongside so exports and backups read on their own
          date: parseDateInput(date),
          note: note.trim(),
        },
        `💵 ${stash.trim()}: ${fmt(total)} counted`
      )
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title="Count cash">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Where is it kept? Chips for the usual places, free text for anything else. */}
      <div className="space-y-1.5">
        <p className="text-xs text-gray-500 dark:text-gray-400">Kept in</p>
        <div className="flex flex-wrap gap-2">
          {knownStashes.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setStash(name)}
              className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                stash.trim().toLowerCase() === name.toLowerCase()
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                  : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
              }`}
            >
              {stashEmoji(name)} {name}
            </button>
          ))}
        </div>
        <input
          value={stash}
          onChange={(e) => setStash(e.target.value)}
          placeholder="or type another place (Bag, Car, Drawer…)"
          className="input"
        />
      </div>

      {/* The count itself */}
      <div className="max-h-[38svh] space-y-1 overflow-y-auto pr-1">
        {(DENOMINATIONS[country] || DENOMINATIONS.JP).map((value) => {
          const qty = denoms[value] ?? ''
          const subtotal = value * (Number(qty) || 0)
          return (
            <div key={value} className="flex items-center gap-2">
              <span
                className={`w-16 shrink-0 text-xs font-semibold tabular-nums ${
                  Number(qty) > 0
                    ? 'text-gray-900 dark:text-gray-100'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                {fmt(value)}
              </span>
              <button
                type="button"
                onClick={() => bump(value, -1)}
                aria-label={`One less ${value}`}
                className="flex tap-target h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-100/80 text-base text-gray-600 transition-transform active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300"
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(value, e.target.value)}
                className="input w-14 shrink-0 px-0 text-center tabular-nums"
              />
              <button
                type="button"
                onClick={() => bump(value, 1)}
                aria-label={`One more ${value}`}
                className="flex tap-target h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-100/80 text-base text-gray-600 transition-transform active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300"
              >
                +
              </button>
              <span className="flex-1 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">
                {subtotal > 0 ? fmt(subtotal) : ''}
              </span>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-100/80 p-3 dark:border-transparent dark:bg-neutral-800/50">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {pieces} note{pieces === 1 ? '' : 's'} & coins
          </span>
          <span className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {fmt(total)}
          </span>
        </div>
        {drift !== null && drift !== 0 && (
          <p
            className={`mt-1 text-[11px] ${
              drift > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {drift > 0 ? '+' : '−'}
            {fmt(Math.abs(drift))} vs. the last {stash.trim()} count
            {drift < 0 ? ' — spending logged since then explains part of it' : ''}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Counted on
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
          />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
        </label>
      </div>

      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : `Save count · ${fmt(total)}`}
      </button>
    </BottomSheet>
  )
}
