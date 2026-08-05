import { useMemo } from 'react'
import { useSettings } from './useSettings'
import { useCollection } from './useCollection'
import { toDate, startOfDay } from '../lib/format'
import { passSpentFrom } from '../lib/passes'
import { transferCredit } from '../lib/wallet'

// Live per-account balances. Each tracked account has an openingBalance set at
// openingBalanceAt (reconcile point); from there, logged records move it:
//   expenses  → matched by paymentMethod === account label (INR card purchases
//               logged with country IN deduct from the IN account, in INR)
//   income    → matched by its optional `account` field
//   transfers → matched by optional `fromAccount` (the amount sent, which the
//               fee is already taken out of), and by
//               optional `toAccount` for a self transfer: the Indian account
//               the money landed in goes UP by the amount received (INR). One
//               record moves both sides, so the pair can never drift.
//   card top-ups → matched by `paidFrom`: loading Pasmo/Edenred from this
//               account moves the money onto the card (bank → card, not
//               new spending — the card purchases are the real expenses)
//   accountEntries → hand-logged "credited / debited": money that moved this
//               account without being an expense, salary or transfer — bank
//               interest, a fee, a UPI credit. Matched by `account`, signed by
//               `direction`, in the account's own currency.
//   office claims → matched by `paidWith`: money you fronted for the office
//               really did leave this account. It comes back as income when
//               the report is paid; without this side the pair would only
//               ever add, inflating the balance by every claim you file.
//               Items logged before `paidWith` existed carry no source and
//               so move nothing, leaving old data exactly as it was.
// Records without a matching account simply don't move any balance.
export function useAccountBalances() {
  const { settings, loading: settingsLoading } = useSettings()
  const accounts = settings?.accounts || []
  // EVERY account gets a balance. One with a starting balance counts from its
  // reconcile point; one left blank starts at zero and counts everything ever
  // logged against it — so money landing in a brand-new account (a remittance
  // into an NRE, say) always shows up instead of vanishing.
  const anchored = accounts.filter(
    (a) => a.openingBalance !== null && a.openingBalance !== undefined && a.openingBalanceAt
  )
  // A zero-based account needs its whole history, so the window only narrows
  // when every account has a reconcile point to start from.
  const minStartMs =
    anchored.length && anchored.length === accounts.length
      ? Math.min(...anchored.map((a) => new Date(a.openingBalanceAt).getTime()))
      : null
  const dateRange = useMemo(
    () => (minStartMs ? { start: new Date(minStartMs) } : undefined),
    [minStartMs]
  )
  const enabled = accounts.length > 0

  const expenses = useCollection('expenses', { dateRange, enabled })
  const income = useCollection('income', { dateRange, enabled })
  const transfers = useCollection('transfers', { dateRange, enabled })
  const recharges = useCollection('pasmoRecharges', { dateRange, enabled })
  const officeItems = useCollection('officeReimbursements', { dateRange, enabled })
  const passes = useCollection('commutePasses', { dateRange, enabled })
  const withdrawals = useCollection('withdrawals', { dateRange, enabled })
  const accountEntries = useCollection('accountEntries', { dateRange, enabled })

  const balances = useMemo(
    () =>
      accounts.map((account) => {
        // No reconcile point yet → start at zero and count from the beginning.
        // Existing anchors are read as midnight of their day, so a balance you
        // typed at 11pm still counts everything logged earlier that day — and
        // old anchors saved with a time-of-day heal themselves without a re-save.
        const since = account.openingBalanceAt
          ? startOfDay(account.openingBalanceAt)
          : new Date(0)
        let balance = account.openingBalance ?? 0
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
            // The fee is taken OUT of the amount sent (Wise deducts it from
            // what you hand over), so `amountSent` is the whole debit — adding
            // the fee on top would charge you for it a second time.
            balance -= r.amountSent || 0
          }
          // Self transfer: what actually landed credits the account it was sent
          // to — rupees received for an Indian account, yen sent for a JP one.
          if (r.toAccount === account.label && toDate(r.date) >= since) {
            balance += transferCredit(r, account.country)
          }
        }
        // Hand-logged credits and debits (interest, bank fee, a UPI credit…).
        for (const r of accountEntries.data) {
          if (r.account !== account.label || toDate(r.date) < since) continue
          balance += r.direction === 'debit' ? -(r.amount || 0) : r.amount || 0
        }
        for (const r of recharges.data) {
          if (r.paidFrom === account.label && toDate(r.date) >= since) {
            balance -= r.amount || 0
          }
        }
        for (const r of officeItems.data) {
          if (r.paidWith === account.label && toDate(r.date) >= since) {
            balance -= r.amount || 0
          }
        }
        // Commuter pass + its refundable deposit, if paid from this account.
        balance -= passSpentFrom(passes.data, account.label, since.getTime())
        // Cash withdrawn from this account — the money left the bank (it's now
        // in your pocket, tracked by the cash count).
        for (const w of withdrawals.data) {
          if (w.account === account.label && toDate(w.date) >= since) {
            balance -= w.amount || 0
          }
        }
        return { ...account, balance, fromZero: !account.openingBalanceAt }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      settings?.accounts,
      expenses.data,
      income.data,
      transfers.data,
      recharges.data,
      officeItems.data,
      passes.data,
      withdrawals.data,
      accountEntries.data,
    ]
  )

  return {
    balances,
    // "Tracked" now means at least one reconciled account — the cue for the
    // set-up-your-balances nudge, not a filter on what gets shown.
    hasTracked: anchored.length > 0,
    hasAccounts: accounts.length > 0,
    loading:
      settingsLoading ||
      (enabled &&
        (expenses.loading ||
          income.loading ||
          transfers.loading ||
          recharges.loading ||
          officeItems.loading ||
          passes.loading ||
          withdrawals.loading ||
          accountEntries.loading)),
  }
}
