import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Landmark, Pencil } from 'lucide-react'
import { useAccountBalances } from '../../hooks/useAccountBalances'
import { useCollection } from '../../hooks/useCollection'
import { useUndoableDelete } from '../../hooks/useUndoableDelete'
import { useLiveRate } from '../../hooks/useLiveRate'
import { useEdenredCredit } from '../../hooks/useEdenredCredit'
import { formatByCountry, formatJPY } from '../../lib/format'
import { cashPosition } from '../../lib/cash'
import { currencyMismatches, mismatchSummary } from '../../lib/currencyAudit'
import { PREPAID_CARDS, EDENRED_MONTHLY, cardBalance } from '../../lib/wallet'
import { cutoffFor as cutoffForAccount } from '../../lib/balances'
import SourceHistorySheet from '../wallet/SourceHistorySheet'
import Skeleton from '../ui/Skeleton'

const FLAGS = { JP: '🇯🇵', IN: '🇮🇳' }

// Running balance per bank account, derived from opening balance + your logs,
// with the notes and coins you're actually carrying — yen and rupees kept
// apart, each counted denomination by denomination on the Cash page.
export default function AccountsCard() {
  const { balances, hasTracked, hasAccounts, loading } = useAccountBalances()
  // The company's monthly Edenred top-up. It lived in a component that stopped
  // being rendered, so it had quietly not run since — see the hook.
  useEdenredCredit()
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

  // Prepaid cards — Pasmo, nimoca, Edenred. Real money you are carrying, and
  // until now the only balance this card left out: it lived on the Wallet page
  // alone, so "combined" was never actually everything.
  //
  // A card you fund yourself appears once it exists for you — three ¥0 rows on
  // a fresh account would be an advert for a feature, not a readout.
  //
  // The COMPANY card is different and always shows. It is topped up for you on
  // the 16th whether you think about it or not, and what is left on it is
  // money you can spend today; hiding it until the first credit landed meant
  // the one card you never manage was the one you could not see.
  const cardRows = PREPAID_CARDS.map((card) => ({
    ...card,
    balance: cardBalance(card.name, recharges.data, expenses.data, officeItems.data, passes.data),
    used: recharges.data.some((r) => (r.card || 'Pasmo') === card.name),
  })).filter((c) => c.company || c.used || Math.abs(c.balance) > 0.01)

  // Records whose currency disagrees with the source they name. Every one of
  // them makes a number on this very card wrong — invisible on a card, taken in
  // the wrong currency from an account, or created outright by funding yen from
  // India. They are announced here because this is where the damage shows.
  const mismatches = currencyMismatches(
    {
      expenses: expenses.data,
      income: income.data,
      withdrawals: withdrawals.data,
      accountEntries: accountEntries.data,
      recharges: recharges.data,
      officeItems: officeItems.data,
      passes: passes.data,
    },
    balances
  )
  const mismatch = mismatchSummary(mismatches)

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
    // Cards hold yen and nothing else.
    ...cardRows.map((c) => ({ country: 'JP', amount: c.balance })),
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
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-indigo-600 dark:text-gray-500 dark:hover:text-indigo-400"
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
              setHistoryOf({
                name: a.label,
                country: a.country,
                since: cutoffForAccount(a),
                // So the sheet can show opening + movements = this balance.
                opening: a.openingBalance ?? 0,
              })
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

        {/* Records dated before an account's opening balance are ignored on
            purpose — the figure typed from the bank app already contains them,
            so counting them again would deduct them twice. Doing that in
            SILENCE is what makes a balance look broken: three expenses sit in
            the History page and the account has not moved a yen. So it says
            so, with a way through to the detail. */}
        {balances.map((a) =>
          a.hidden?.count > 0 ? (
            <button
              key={`hidden-${a.id}`}
              type="button"
              onClick={() =>
                setHistoryOf({
                name: a.label,
                country: a.country,
                since: cutoffForAccount(a),
                // So the sheet can show opening + movements = this balance.
                opening: a.openingBalance ?? 0,
              })
              }
              className="flex w-full items-start gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-left transition-transform active:scale-[0.99] touch-manipulation"
            >
              <span className="text-xs" aria-hidden="true">
                ⓘ
              </span>
              <span className="min-w-0 flex-1 text-[11px] text-amber-700 dark:text-amber-400">
                {a.label}: {a.hidden.count} record{a.hidden.count === 1 ? '' : 's'} worth{' '}
                {formatByCountry(a.hidden.total, a.country)} are dated before this balance was set
                ({a.hidden.since?.toLocaleDateString()}), so they don't move it — the figure you
                typed already included them.
              </span>
              <ChevronRight size={13} className="mt-0.5 shrink-0 text-amber-600/70" aria-hidden="true" />
            </button>
          ) : null
        )}

        {mismatch && (
          <Link
            to="/history"
            className="flex w-full items-start gap-2 rounded-lg bg-red-500/10 px-2.5 py-2 text-left transition-transform active:scale-[0.99] touch-manipulation"
          >
            <span className="text-xs" aria-hidden="true">
              ⚠️
            </span>
            <span className="min-w-0 flex-1 text-[11px] text-red-700 dark:text-red-400">
              {mismatch.count} record{mismatch.count === 1 ? '' : 's'} {mismatch.count === 1 ? 'is' : 'are'} filed in
              the wrong currency for where {mismatch.count === 1 ? 'it was' : 'they were'} paid from
              {mismatches
                .slice(0, 2)
                .map((m) => ` — ${m.label || m.collection} (${m.where} ${m.source})`)
                .join('')}
              {mismatch.count > 2 ? '…' : ''}.
              {mismatch.invented > 0 &&
                ` ${mismatch.invented} ${mismatch.invented === 1 ? 'moves' : 'move'} yen out of a rupee account, which invents money.`}
              {' '}Fix the country on {mismatch.count === 1 ? 'it' : 'them'} so these balances are right.
            </span>
            <ChevronRight size={13} className="mt-0.5 shrink-0 text-red-600/70" aria-hidden="true" />
          </Link>
        )}

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

        {/* Prepaid cards, after the cash they are usually loaded from. */}
        {cardRows.map((c) => (
          <Link
            key={c.name}
            to="/balances"
            className="flex items-center justify-between gap-2 transition-transform active:scale-[0.99] touch-manipulation"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <span aria-hidden="true">{c.emoji}</span>
              <span className="truncate font-medium">{c.name}</span>
              {c.company && (
                <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                  {c.used ? 'company card' : `company card · ¥${EDENRED_MONTHLY.amount.toLocaleString()} on the ${EDENRED_MONTHLY.day}th`}
                </span>
              )}
            </span>
            <span
              className={`shrink-0 text-sm font-semibold tabular-nums ${
                c.balance < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {formatJPY(c.balance)}
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
