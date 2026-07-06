import { useMemo } from 'react'
import { useSettings } from './useSettings'
import { useCollection } from './useCollection'
import { toDate } from '../lib/format'

// Live per-account balances. Each tracked account has an openingBalance set at
// openingBalanceAt (reconcile point); from there, logged records move it:
//   expenses  → matched by paymentMethod === account label (INR card purchases
//               logged with country IN deduct from the IN account, in INR)
//   income    → matched by its optional `account` field
//   transfers → matched by optional `fromAccount` (amount sent + fee)
// Records without a matching account simply don't move any balance.
export function useAccountBalances() {
  const { settings, loading: settingsLoading } = useSettings()
  const accounts = settings?.accounts || []
  const tracked = accounts.filter(
    (a) => a.openingBalance !== null && a.openingBalance !== undefined && a.openingBalanceAt
  )

  const minStartMs = tracked.length
    ? Math.min(...tracked.map((a) => new Date(a.openingBalanceAt).getTime()))
    : null
  const dateRange = useMemo(
    () => (minStartMs ? { start: new Date(minStartMs) } : undefined),
    [minStartMs]
  )
  const enabled = tracked.length > 0

  const expenses = useCollection('expenses', { dateRange, enabled })
  const income = useCollection('income', { dateRange, enabled })
  const transfers = useCollection('transfers', { dateRange, enabled })

  const balances = useMemo(
    () =>
      tracked.map((account) => {
        const since = new Date(account.openingBalanceAt)
        let balance = account.openingBalance
        for (const r of expenses.data) {
          if (r.paymentMethod === account.label && toDate(r.date) >= since) {
            balance -= r.amount || 0
          }
        }
        for (const r of income.data) {
          if (r.account === account.label && toDate(r.date) >= since) {
            balance += r.amount || 0
          }
        }
        for (const r of transfers.data) {
          if (r.fromAccount === account.label && toDate(r.date) >= since) {
            balance -= (r.amountSent || 0) + (r.fee || 0)
          }
        }
        return { ...account, balance }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings?.accounts, expenses.data, income.data, transfers.data]
  )

  return {
    balances,
    hasTracked: tracked.length > 0,
    hasAccounts: accounts.length > 0,
    loading: settingsLoading || (enabled && (expenses.loading || income.loading || transfers.loading)),
  }
}
