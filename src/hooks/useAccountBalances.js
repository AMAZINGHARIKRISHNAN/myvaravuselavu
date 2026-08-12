import { useMemo } from 'react'
import { useSettings } from './useSettings'
import { useCollection } from './useCollection'
import { accountBalance, ignoredBeforeCutoff } from '../lib/balances'

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
  const enabled = accounts.length > 0

  // Deliberately UNRANGED, even though the balance maths only needs records
  // after the earliest reconcile point.
  //
  // useCollection shares one listener per collection+range, and every screen
  // that shows a balance next to something else — AccountsCard, the Wallet
  // page, Cash, Reconcile — needs the unranged feed anyway (a card balance
  // reads every expense ever paid with that card). Narrowing the window here
  // therefore did not save a listener, it added one: a second subscription to
  // the same eight collections under a different key, sixteen where eight
  // would do, on the landing screen. The rows dropped by the cutoff are
  // filtered below in a loop that was already running.
  const expenses = useCollection('expenses', { enabled })
  const income = useCollection('income', { enabled })
  const transfers = useCollection('transfers', { enabled })
  const recharges = useCollection('pasmoRecharges', { enabled })
  const officeItems = useCollection('officeReimbursements', { enabled })
  const passes = useCollection('commutePasses', { enabled })
  const withdrawals = useCollection('withdrawals', { enabled })
  const accountEntries = useCollection('accountEntries', { enabled })

  // The maths lives in lib/balances.js so it can be tested against
  // buildHistory — the history sheet exists to explain the balance, and while
  // both sets of rules were written out separately nothing forced them to
  // agree. See lib/ledgerAudit.test.js.
  const data = useMemo(
    () => ({
      expenses: expenses.data,
      income: income.data,
      transfers: transfers.data,
      recharges: recharges.data,
      officeItems: officeItems.data,
      passes: passes.data,
      withdrawals: withdrawals.data,
      accountEntries: accountEntries.data,
    }),
    [
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

  const balances = useMemo(
    () =>
      accounts.map((account) => ({
        ...account,
        balance: accountBalance(account, data, accounts),
        fromZero: !account.openingBalanceAt,
        // What the opening balance is hiding, so a screen can say so rather
        // than leaving three expenses looking as if they did nothing.
        hidden: ignoredBeforeCutoff(account, data),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings?.accounts, data]
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
