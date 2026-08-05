import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAccountBalances } from '../../hooks/useAccountBalances'
import { useCollection } from '../../hooks/useCollection'
import { useSettings } from '../../hooks/useSettings'
import { useBatchOps } from '../../hooks/useBatchOps'
import { useToast } from '../../context/ToastContext'
import { formatByCountry, formatJPY } from '../../lib/format'
import { PREPAID_CARDS, EDENRED_MONTHLY, cardBalance } from '../../lib/wallet'
import { cashPosition } from '../../lib/cash'

const FLAGS = { JP: '🇯🇵', IN: '🇮🇳' }

// One-glance money row under the stat boxes: every balance (banks + prepaid
// cards) as chips. The whole strip opens the Wallet page, where each one
// drills into its full history.
export default function BalancesStrip() {
  const { balances, loading } = useAccountBalances()
  const recharges = useCollection('pasmoRecharges')
  const expenses = useCollection('expenses')
  const income = useCollection('income')
  const cashCounts = useCollection('cashCounts')
  const officeItems = useCollection('officeReimbursements')
  const passes = useCollection('commutePasses')
  const withdrawals = useCollection('withdrawals')
  const accountEntries = useCollection('accountEntries')
  const { settings, save } = useSettings()
  const batchOps = useBatchOps()
  const { toast } = useToast()

  // Company Edenred credit: ¥10,000 lands on the 16th every month. Credit it
  // automatically on the first app open on/after the 16th; the settings
  // marker keeps it once-per-month (and respects a manual delete).
  const creditRan = useRef(false)
  useEffect(() => {
    if (creditRan.current || !settings || recharges.loading) return
    const now = new Date()
    if (now.getDate() < EDENRED_MONTHLY.day) return
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    if (settings.edenredLastCredit === monthKey) return
    creditRan.current = true
    ;(async () => {
      try {
        // Fixed per-month id: if two devices race this, both write the SAME
        // document — one credit, never two.
        await batchOps([
          {
            op: 'set',
            name: 'pasmoRecharges',
            id: `edenred-${monthKey}`,
            data: {
              card: 'Edenred',
              amount: EDENRED_MONTHLY.amount,
              paidFrom: null, // company money — nothing of yours is deducted
              auto: true,
              date: new Date(now.getFullYear(), now.getMonth(), EDENRED_MONTHLY.day, 12),
              note: 'Company credit (auto)',
            },
          },
        ])
        await save({ edenredLastCredit: monthKey })
        toast(`🍴 ${formatJPY(EDENRED_MONTHLY.amount)} Edenred credit from company added`)
      } catch {
        creditRan.current = false // retry next open
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, recharges.loading])

  if (
    loading ||
    recharges.loading ||
    expenses.loading ||
    officeItems.loading ||
    passes.loading ||
    withdrawals.loading
  )
    return null

  const chips = [
    ...balances.map((a) => ({
      key: a.id,
      emoji: FLAGS[a.country] || '🏦',
      label: a.label,
      text: formatByCountry(a.balance, a.country),
      negative: a.balance < 0,
    })),
    // Cards only appear once they've been topped up at least once.
    ...PREPAID_CARDS.filter((c) =>
      recharges.data.some((r) => (r.card || 'Pasmo') === c.name)
    ).map((c) => {
      const balance = cardBalance(c.name, recharges.data, expenses.data, officeItems.data, passes.data)
      return {
        key: c.name,
        emoji: c.emoji,
        label: c.name,
        text: formatJPY(balance),
        negative: balance < 0,
      }
    }),
  ]

  // Physical cash, once counted — yen and rupees each get their own chip.
  for (const country of ['JP', 'IN']) {
    const cash = cashPosition({
      counts: cashCounts.data,
      expenses: expenses.data,
      income: income.data,
      recharges: recharges.data,
      officeItems: officeItems.data,
      passes: passes.data,
      withdrawals: withdrawals.data,
      accountEntries: accountEntries.data,
      country,
    })
    if (!cash.hasCount) continue
    chips.push({
      key: `cash-${country}`,
      emoji: '💵',
      label: `Cash ${FLAGS[country]}`,
      text: formatByCountry(cash.expected, country),
      negative: cash.expected < 0,
    })
  }

  if (chips.length === 0) {
    return (
      <Link
        to="/balances"
        className="block rounded-2xl border border-dashed border-gray-500/40 px-4 py-2.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200 touch-manipulation"
      >
        👛 Set up your wallet — track bank, Pasmo & Edenred balances in one place
      </Link>
    )
  }

  return (
    <Link
      to="/balances"
      aria-label="Open wallet — all balances and their histories"
      className="no-scrollbar flex gap-2 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch] touch-manipulation"
    >
      {chips.map((c) => (
        <span
          key={c.key}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-300/70 bg-white px-3 py-1.5 text-xs shadow-sm dark:border-transparent dark:bg-neutral-900"
        >
          <span aria-hidden="true">{c.emoji}</span>
          <span className="font-medium text-gray-600 dark:text-gray-300">{c.label}</span>
          <span
            className={`font-bold tabular-nums ${
              c.negative ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
            }`}
          >
            {c.text}
          </span>
        </span>
      ))}
      <span className="flex shrink-0 items-center rounded-full border border-gray-300/70 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 shadow-sm dark:border-transparent dark:bg-neutral-900 dark:text-indigo-400">
        👛 All →
      </span>
    </Link>
  )
}
