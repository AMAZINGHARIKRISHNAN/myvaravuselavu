import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, ScanLine } from 'lucide-react'
import { useAccountBalances } from '../hooks/useAccountBalances'
import { useCollection } from '../hooks/useCollection'
import { useBatchOps } from '../hooks/useBatchOps'
import { useToast } from '../context/ToastContext'
import { formatByCountry, toDateInputValue, parseDateInput, toDate } from '../lib/format'
import { cashPosition } from '../lib/cash'
import { PREPAID_CARDS, cardBalance } from '../lib/wallet'
import { CATEGORIES, CATEGORY_ICONS } from '../lib/constants'
import { typesFor, remaining, isSettled, reconcileOps } from '../lib/reconcile'
import { countryOf, fundingSources } from '../lib/money'
import { findUntagged, assignOps } from '../lib/untagged'
import { useSettings } from '../hooks/useSettings'
import Skeleton from '../components/ui/Skeleton'
import InvisibleRecords from '../components/wallet/InvisibleRecords'

const FLAGS = { JP: '🇯🇵', IN: '🇮🇳' }

// Verify the books against reality, one source at a time.
//
// Days of not logging leave the app's balance and your bank's balance out of
// step. Here you type what each one really holds; anything that doesn't match
// opens up so you can say where the money went — a spend, cash you pulled out,
// a fee — each on its own date. The gap counts down as you go, and whatever you
// can't place is booked as "unexplained" so the balance still lands on reality.
// Nothing is written until you press the button: it's one atomic commit per
// source, so a dropped connection can't half-fix your books.
export default function Reconcile() {
  const { balances, loading: balancesLoading } = useAccountBalances()
  const cashCounts = useCollection('cashCounts')
  const expenses = useCollection('expenses')
  const income = useCollection('income')
  const recharges = useCollection('pasmoRecharges')
  const officeItems = useCollection('officeReimbursements')
  const passes = useCollection('commutePasses')
  const withdrawals = useCollection('withdrawals')
  const accountEntries = useCollection('accountEntries')
  const reconciles = useCollection('reconciles')
  const { settings } = useSettings()
  const batchOps = useBatchOps()
  const { toast } = useToast()

  // label -> typed actual balance; label -> line rows; which row is expanded
  const [actuals, setActuals] = useState({})
  const [lines, setLines] = useState({})
  const [openKey, setOpenKey] = useState(null)
  const [busy, setBusy] = useState(null)

  const loading =
    balancesLoading ||
    cashCounts.loading ||
    expenses.loading ||
    income.loading ||
    recharges.loading ||
    officeItems.loading ||
    passes.loading ||
    withdrawals.loading ||
    accountEntries.loading

  // Every source you can check: each bank account, then cash per currency.
  const sources = useMemo(() => {
    const cashData = {
      counts: cashCounts.data,
      expenses: expenses.data,
      income: income.data,
      recharges: recharges.data,
      officeItems: officeItems.data,
      passes: passes.data,
      withdrawals: withdrawals.data,
      accountEntries: accountEntries.data,
    }
    const rows = balances.map((a) => ({
      key: a.label,
      account: a.label,
      label: a.label,
      emoji: FLAGS[a.country] || '🏦',
      country: a.country || 'JP',
      isCash: false,
      tracked: a.balance,
      // Records dated before this can't move the balance — it's the reconcile
      // point set in Settings, so the date pickers start there.
      since: a.openingBalanceAt ? toDate(a.openingBalanceAt) : null,
      hint: a.openingBalanceAt
        ? `counting from ${toDate(a.openingBalanceAt)?.toLocaleDateString()}`
        : 'counting every entry ever logged',
    }))
    // Prepaid cards: same idea, tapped from the card's own balance. Only ones
    // you've actually used show up.
    for (const card of PREPAID_CARDS) {
      if (!recharges.data.some((r) => (r.card || 'Pasmo') === card.name)) continue
      rows.push({
        key: card.name,
        account: card.name,
        label: card.name,
        emoji: card.emoji,
        country: 'JP',
        isCash: false,
        isCard: true,
        tracked: cardBalance(
          card.name,
          recharges.data,
          expenses.data,
          officeItems.data,
          passes.data
        ),
        since: null,
        hint: 'prepaid card',
      })
    }
    for (const country of ['JP', 'IN']) {
      const pos = cashPosition({ ...cashData, country })
      if (country === 'IN' && !pos.hasCount && Math.abs(pos.expected) < 0.01) continue
      rows.push({
        key: `Cash-${country}`,
        account: 'Cash',
        label: `Cash in hand ${FLAGS[country]}`,
        emoji: '💵',
        country,
        isCash: true,
        tracked: pos.expected,
        since: pos.countedAt || null,
        hint: pos.countedAt
          ? `counted ${pos.countedAt.toLocaleDateString()}`
          : 'never counted — from your logs',
      })
    }
    return rows
  }, [
    balances,
    cashCounts.data,
    expenses.data,
    income.data,
    recharges.data,
    officeItems.data,
    passes.data,
    withdrawals.data,
    accountEntries.data,
  ])

  const lastRun = useMemo(
    () => [...reconciles.data].sort((a, b) => (toDate(b.date) || 0) - (toDate(a.date) || 0))[0],
    [reconciles.data]
  )

  const diffOf = (s) => {
    const typed = actuals[s.key]
    if (typed === undefined || typed === '' || typed === null) return null
    const actual = parseFloat(typed)
    if (!Number.isFinite(actual)) return null
    return Math.round((actual - s.tracked) * 100) / 100
  }

  const rowsOf = (key) => lines[key] || []
  const setRows = (key, next) => setLines((prev) => ({ ...prev, [key]: next }))
  const addRow = (s) => {
    const types = typesFor(s)
    const diff = diffOf(s) ?? 0
    // Lead with the type that fits the direction of the gap.
    const preferred = diff > 0 ? types.find((t) => t.sign > 0) : types.find((t) => t.sign < 0)
    setRows(s.key, [
      ...rowsOf(s.key),
      {
        type: preferred?.key || types[0].key,
        what: '',
        category: 'Food',
        amount: '',
        date: toDateInputValue(new Date()),
      },
    ])
  }
  const setRow = (key, i, patch) =>
    setRows(key, rowsOf(key).map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const commit = async (s) => {
    const diff = diffOf(s)
    if (diff === null || Math.abs(diff) < 0.005) return
    setBusy(s.key)
    try {
      const rows = rowsOf(s.key).map((r) => ({ ...r, date: parseDateInput(r.date) }))
      const ops = reconcileOps({
        diff,
        lines: rows,
        ctx: {
          account: s.account,
          country: s.country,
          isCash: s.isCash,
          isCard: s.isCard || false,
          date: new Date(),
        },
      })
      await batchOps([
        ...ops,
        // The audit trail: what was checked, what it was off by, how much of
        // that you could actually place.
        {
          op: 'set',
          name: 'reconciles',
          data: {
            date: new Date(),
            source: s.label,
            account: s.account,
            country: s.country,
            isCash: s.isCash,
            isCard: s.isCard || false,
            tracked: s.tracked,
            actual: Math.round(parseFloat(actuals[s.key]) * 100) / 100,
            diff,
            explained: rows.filter((r) => (parseFloat(r.amount) || 0) > 0).length,
            unexplained: remaining(diff, rows),
          },
        },
      ])
      const left = remaining(diff, rows)
      toast(
        `✅ ${s.label} reconciled · ${ops.length} record${ops.length === 1 ? '' : 's'} logged${
          Math.abs(left) >= 0.005
            ? ` · ${formatByCountry(Math.abs(left), s.country)} unexplained`
            : ''
        }`
      )
      setActuals((prev) => ({ ...prev, [s.key]: '' }))
      setRows(s.key, [])
      setOpenKey(null)
    } catch {
      toast('Could not save — nothing was written. Try again.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-16 lg:mx-auto lg:max-w-2xl lg:pb-0">
      <div className="card p-4 space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <ScanLine size={15} aria-hidden="true" /> Check against reality
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Open your bank app and type what each account really holds. Anything that doesn't match
          opens up so you can log where the money went, date by date — cash you pulled out lands in
          your cash on hand, and whatever you can't place is marked unexplained.
        </p>
        {lastRun && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Last checked {toDate(lastRun.date)?.toLocaleDateString()} · {lastRun.source}
          </p>
        )}
      </div>

      <div className="space-y-3">
        {sources.map((s) => {
          const diff = diffOf(s)
          const matched = diff !== null && Math.abs(diff) < 0.005
          const rows = rowsOf(s.key)
          const left = diff === null ? 0 : remaining(diff, rows)
          const settled = diff !== null && isSettled(diff, rows)
          const open = openKey === s.key
          const types = typesFor(s)
          const minDate = s.since ? toDateInputValue(s.since) : undefined

          return (
            <div key={s.key} className="card overflow-hidden">
              <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true">{s.emoji}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {s.label}
                      </span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                        app says {formatByCountry(s.tracked, s.country)} · {s.hint}
                      </span>
                    </span>
                  </span>
                  {matched && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                      <Check size={11} /> Matches
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder={`Actual balance (${s.country === 'IN' ? '₹' : '¥'})`}
                    value={actuals[s.key] ?? ''}
                    onChange={(e) => {
                      setActuals((prev) => ({ ...prev, [s.key]: e.target.value }))
                      setOpenKey(s.key)
                    }}
                    className="input min-w-0 flex-1"
                  />
                  {diff !== null && !matched && (
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums ${
                        diff < 0
                          ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                      }`}
                    >
                      {diff < 0 ? '−' : '+'}
                      {formatByCountry(Math.abs(diff), s.country)}
                    </span>
                  )}
                </div>

                {diff !== null && !matched && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {diff < 0
                      ? `You have ${formatByCountry(Math.abs(diff), s.country)} less than the app thinks — spending, cash or fees that never got logged.`
                      : `You have ${formatByCountry(diff, s.country)} more than the app thinks — money that came in without being logged.`}
                  </p>
                )}
              </div>

              {diff !== null && !matched && (
                <div className="border-t border-gray-200 p-4 space-y-3 dark:border-white/5">
                  <button
                    type="button"
                    onClick={() => setOpenKey(open ? null : s.key)}
                    className="flex w-full items-center justify-between gap-2 text-left"
                  >
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                      Where did it go? {rows.length > 0 && `· ${rows.length} line${rows.length === 1 ? '' : 's'}`}
                    </span>
                    <span
                      className={`flex items-center gap-1.5 text-[11px] font-bold ${
                        settled
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {settled
                        ? 'All accounted for ✓'
                        : `${formatByCountry(Math.abs(left), s.country)} to explain`}
                      <ChevronDown
                        size={13}
                        className={`transition-transform ${open ? 'rotate-180' : ''}`}
                      />
                    </span>
                  </button>

                  {open && (
                    <>
                      {rows.map((r, i) => {
                        const type = types.find((t) => t.key === r.type)
                        return (
                          <div
                            key={i}
                            className="space-y-1.5 rounded-xl border border-gray-200 bg-gray-100/70 p-2.5 dark:border-transparent dark:bg-neutral-800/50"
                          >
                            <div className="flex items-center gap-1.5">
                              <select
                                value={r.type}
                                onChange={(e) => setRow(s.key, i, { type: e.target.value })}
                                className="input min-w-0 flex-1 text-xs"
                                aria-label={`What happened, line ${i + 1}`}
                              >
                                {types.map((t) => (
                                  <option key={t.key} value={t.key}>
                                    {t.label}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                step="any"
                                inputMode="decimal"
                                placeholder="0"
                                value={r.amount}
                                onChange={(e) => setRow(s.key, i, { amount: e.target.value })}
                                className="input w-24 shrink-0 text-xs"
                                aria-label={`Amount, line ${i + 1}`}
                              />
                              <button
                                type="button"
                                onClick={() => setRows(s.key, rows.filter((_, idx) => idx !== i))}
                                aria-label={`Remove line ${i + 1}`}
                                className="shrink-0 px-1 text-gray-400 hover:text-red-500 active:scale-90 dark:text-gray-500"
                              >
                                ✕
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                placeholder="What for? e.g. groceries"
                                value={r.what}
                                onChange={(e) => setRow(s.key, i, { what: e.target.value })}
                                className="input min-w-0 flex-1 text-xs"
                              />
                              {type?.needsCategory && (
                                <select
                                  value={r.category}
                                  onChange={(e) => setRow(s.key, i, { category: e.target.value })}
                                  className="input w-24 shrink-0 text-xs"
                                  aria-label={`Category, line ${i + 1}`}
                                >
                                  {CATEGORIES.map((c) => (
                                    <option key={c} value={c}>
                                      {CATEGORY_ICONS[c]} {c}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <input
                                type="date"
                                value={r.date}
                                min={minDate}
                                onChange={(e) => setRow(s.key, i, { date: e.target.value })}
                                className="input w-32 shrink-0 text-xs"
                                aria-label={`Date, line ${i + 1}`}
                              />
                            </div>
                            {minDate && r.date < minDate && (
                              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                Dated before this source's reconcile point — it won't move the
                                balance.
                              </p>
                            )}
                          </div>
                        )
                      })}

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => addRow(s)}
                          className="rounded-lg border border-dashed border-gray-300 py-2 text-xs font-medium text-gray-500 hover:border-indigo-400 hover:text-indigo-600 active:scale-[0.98] dark:border-neutral-700 dark:text-gray-400 dark:hover:text-indigo-400"
                        >
                          ＋ Add a line
                        </button>
                        <button
                          type="button"
                          disabled={Math.abs(left) < 0.005 || rows.length === 0}
                          onClick={() =>
                            setRows(
                              s.key,
                              rows.map((r, idx) =>
                                idx === rows.length - 1
                                  ? {
                                      ...r,
                                      amount: String(
                                        Math.round(
                                          ((parseFloat(r.amount) || 0) + Math.abs(left)) * 100
                                        ) / 100
                                      ),
                                    }
                                  : r
                              )
                            )
                          }
                          className="rounded-lg border border-dashed border-gray-300 py-2 text-xs font-medium text-gray-500 disabled:opacity-40 hover:border-indigo-400 hover:text-indigo-600 active:scale-[0.98] dark:border-neutral-700 dark:text-gray-400 dark:hover:text-indigo-400"
                        >
                          Use the rest
                        </button>
                      </div>

                      <p className="text-[11px] text-gray-400 dark:text-gray-500">
                        {Math.abs(left) < 0.005
                          ? 'Every yen is placed — nothing will be marked unexplained.'
                          : `${formatByCountry(Math.abs(left), s.country)} will be logged as "❓ Unexplained" so ${s.label} still ends up matching reality.`}
                      </p>

                      <button
                        type="button"
                        disabled={busy === s.key}
                        onClick={() => commit(s)}
                        className="btn-primary w-full py-3 text-sm"
                      >
                        {busy === s.key
                          ? 'Saving…'
                          : `Log & fix ${s.label} · ${formatByCountry(Math.abs(diff), s.country)}`}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Money that is logged but invisible for a different reason: no date at
          all, so the ordered query that feeds every screen skips it. */}
      <InvisibleRecords />

      <UntaggedSection
        income={income.data}
        expenses={expenses.data}
        accounts={settings?.accounts || []}
        onAssign={async (rows, label) => {
          const ops = assignOps(rows, label)
          for (let i = 0; i < ops.length; i += 400) await batchOps(ops.slice(i, i + 400))
          toast(`✓ ${ops.length} record${ops.length === 1 ? '' : 's'} now count towards ${label}`)
        }}
      />

      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Every line becomes a real record of its own kind — spending shows up in your categories and
        charts, cash you took out lands in{' '}
        <Link to="/cash" className="text-indigo-500 underline">
          cash on hand
        </Link>
        , fees move only the balance. They're written in one commit per account and appear in{' '}
        <Link to="/history" className="text-indigo-500 underline">
          History
        </Link>{' '}
        on the dates you gave them.
      </p>
    </div>
  )
}

// Money that's logged but invisible to every balance: income that never named
// an account, and records still pointing at a name that no longer exists (a
// rename from before renames carried their history). Pick where each batch
// really belongs and the balances pick them up immediately.
function UntaggedSection({ income, expenses, accounts, onAssign }) {
  const rows = useMemo(
    () => findUntagged({ income, expenses, accounts }),
    [income, expenses, accounts]
  )
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState({})
  const [busy, setBusy] = useState(null)

  if (rows.length === 0) return null

  // Grouped by what they currently say, so a whole renamed account is one fix.
  const groups = new Map()
  for (const r of rows) {
    const key = r.current || '—'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  // This screen exists to repair records, so it must not be able to break one a
  // different way. When every record in a batch is the same currency, only that
  // currency's accounts are offered — assigning rupee income to a yen account
  // would take it off one invisible list and put it on a wrong one. A mixed
  // batch is left open, and the dashboard's currency check catches any slip.
  const targetsFor = (list) => {
    const countries = new Set(list.map((r) => countryOf(r)))
    if (countries.size !== 1) return [...accounts.map((a) => a.label), 'Cash']
    return fundingSources(accounts, [...countries][0])
  }

  return (
    <div className="card p-4 space-y-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
            ⚠️ {rows.length} record{rows.length === 1 ? '' : 's'} move no balance
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Logged, but pointing at nothing the app knows — so no account ever sees them
          </span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        [...groups.entries()].map(([key, list]) => (
          <div
            key={key}
            className="space-y-2 rounded-xl border border-gray-200 bg-gray-100/70 p-3 dark:border-transparent dark:bg-neutral-800/50"
          >
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              {key === '—' ? 'No account named' : `Points at "${key}" — no such source`} ·{' '}
              {list.length} record{list.length === 1 ? '' : 's'}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {list
                .slice(0, 3)
                .map((r) => r.source || r.note || r.category || 'record')
                .join(', ')}
              {list.length > 3 && ` and ${list.length - 3} more`}
            </p>
            <div className="flex flex-wrap gap-2">
              {targetsFor(list).map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setTarget((prev) => ({ ...prev, [key]: label }))}
                  className={`min-h-9 rounded-full px-3.5 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                    target[key] === label
                      ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                      : 'border border-gray-200 bg-white text-gray-700 dark:border-transparent dark:bg-neutral-800 dark:text-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!target[key] || busy === key}
              onClick={async () => {
                setBusy(key)
                try {
                  await onAssign(list, target[key])
                } finally {
                  setBusy(null)
                }
              }}
              className="btn-primary w-full py-2.5 text-xs disabled:opacity-40"
            >
              {busy === key
                ? 'Moving…'
                : `Point ${list.length} record${list.length === 1 ? '' : 's'} at ${target[key] || '…'}`}
            </button>
          </div>
        ))}
    </div>
  )
}
