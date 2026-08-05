import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Landmark, Pencil } from 'lucide-react'
import { useAccountBalances } from '../../hooks/useAccountBalances'
import { useCollection } from '../../hooks/useCollection'
import { useUndoableDelete } from '../../hooks/useUndoableDelete'
import { useLiveRate } from '../../hooks/useLiveRate'
import { formatByCountry, formatJPY } from '../../lib/format'
import { cashPosition } from '../../lib/cash'
import SourceHistorySheet from '../wallet/SourceHistorySheet'
import Skeleton from '../ui/Skeleton'

const FLAGS = { JP: '🇯🇵', IN: '🇮🇳' }

// Running balance per bank account, derived from opening balance + your logs,
// with the notes and coins you're actually carrying — yen and rupees kept
// apart, each counted denomination by denomination on the Cash page.
export default function AccountsCard() {
  const { balances, hasTracked, hasAccounts, loading } = useAccountBalances()
  const { rate: liveRate } = useLiveRate()
  const cashCounts = useCollection('cashCounts')
  const expenses = useCollection('expenses')
  const income = useCollection('income')
  const recharges = useCollection('pasmoRecharges')
  const officeItems = useCollection('officeReimbursements')
  const passes = useCollection('commutePasses')
  const withdrawals = useCollection('withdrawals')
  const transfers = useCollection('transfers')
  const accountEntries = useCollection('accountEntries')

  // Tap any row for everything that ever touched it — the same sheet the
  // Wallet page opens, so both read identically.
  const [historyOf, setHistoryOf] = useState(null)
  const rechargeUndo = useUndoableDelete(recharges.remove, 'Top-up')
  const entryUndo = useUndoableDelete(accountEntries.remove, 'Entry')

  // Cash in hand, per currency. Yen always shows — it's the home currency, and
  // even with no count the logs (withdrawals in, cash spending out) say what
  // you should be holding. Rupees show once there's anything to show.
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
    .filter((c) => c.country === 'JP' || c.hasCount || Math.abs(c.expected) > 0.01)

  if (!hasAccounts) return null

  if (!hasTracked) {
    return (
      <Link
        to="/settings"
        className="card flex items-center gap-3 p-4 transition-transform active:scale-[0.99] touch-manipulation"
      >
        <span className="icon-tile">
          <Landmark size={15} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
            Track your account balances
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Set each account's current balance in Settings — your logs keep it updated
          </span>
        </span>
      </Link>
    )
  }

  if (loading) return <Skeleton className="h-32 w-full" />

  // Approximate combined worth in JPY (INR converted at the live rate), cash
  // in hand included — it's money you have, wherever it's sitting.
  const worth = [
    ...balances.map((a) => ({ country: a.country, amount: a.balance })),
    ...cashRows.map((c) => ({ country: c.country, amount: c.expected })),
  ]
  const jpyTotal = worth.reduce((sum, a) => {
    if (a.country !== 'IN') return sum + a.amount
    return liveRate ? sum + a.amount / liveRate : sum
  }, 0)
  const hasInr = worth.some((a) => a.country === 'IN')
  const showTotal = worth.length > 1 && (!hasInr || liveRate)

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <span className="icon-tile h-7 w-7">
            <Landmark size={13} aria-hidden="true" />
          </span>
          Accounts
        </h2>
        <Link
          to="/settings"
          aria-label="Edit accounts"
          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-indigo-600 dark:text-gray-500 dark:hover:text-indigo-400"
        >
          <Pencil size={13} />
        </Link>
      </div>

      <div className="space-y-2.5">
        {balances.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() =>
              setHistoryOf({ name: a.label, country: a.country, since: a.openingBalanceAt })
            }
            className="flex w-full items-center justify-between gap-2 text-left transition-transform active:scale-[0.99] touch-manipulation"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <span aria-hidden="true">{FLAGS[a.country] || '🏦'}</span>
              <span className="truncate font-medium">{a.label}</span>
            </span>
            <span
              className={`shrink-0 text-sm font-semibold tabular-nums ${
                a.balance < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {formatByCountry(a.balance, a.country)}
            </span>
            <ChevronRight size={13} className="-ml-1 shrink-0 text-gray-400" aria-hidden="true" />
          </button>
        ))}

        {/* Cash in hand, per currency — tap through to count it note by note
            and coin by coin on the Cash page. */}
        {cashRows.map((c) => (
          <Link
            key={c.country}
            to="/cash"
            className="flex items-center justify-between gap-2 transition-transform active:scale-[0.99] touch-manipulation"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <span aria-hidden="true">💵</span>
              <span className="truncate font-medium">Cash in hand {FLAGS[c.country]}</span>
              <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                {c.hasCount
                  ? `${c.stashes.length} place${c.stashes.length === 1 ? '' : 's'}`
                  : 'from your logs · tap to count'}
              </span>
            </span>
            <span
              className={`shrink-0 text-sm font-semibold tabular-nums ${
                c.expected < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {formatByCountry(c.expected, c.country)}
            </span>
            <ChevronRight size={13} className="-ml-1 shrink-0 text-gray-400" aria-hidden="true" />
          </Link>
        ))}
      </div>

      {showTotal && (
        <p className="border-t border-gray-200 pt-2 text-[11px] text-gray-500 dark:border-white/5 dark:text-gray-400">
          ≈ {formatJPY(Math.round(jpyTotal))} combined{hasInr ? ' (at live rate)' : ''}
        </p>
      )}

      {historyOf && (
        <SourceHistorySheet
          source={historyOf}
          data={{
            expenses: expenses.data,
            income: income.data,
            transfers: transfers.data,
            recharges: recharges.data.filter((r) => !rechargeUndo.pendingIds.has(r.id)),
            officeItems: officeItems.data,
            passes: passes.data,
            withdrawals: withdrawals.data,
            accountEntries: accountEntries.data.filter((r) => !entryUndo.pendingIds.has(r.id)),
          }}
          onUndo={rechargeUndo.requestDelete}
          onUndoEntry={entryUndo.requestDelete}
          onClose={() => setHistoryOf(null)}
        />
      )}
    </div>
  )
}
