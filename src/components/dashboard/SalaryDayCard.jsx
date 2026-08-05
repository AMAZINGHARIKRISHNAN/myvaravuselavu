import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCollection } from '../../hooks/useCollection'
import { useSettings } from '../../hooks/useSettings'
import { useBatchOps } from '../../hooks/useBatchOps'
import { useToast } from '../../context/ToastContext'
import { formatJPY } from '../../lib/format'
import { claimStage, claimApproved } from '../../lib/commute'
import { salaryStatus } from '../../lib/salary'

// Payday check-in. Salary lands on the 25th — or the working day before, if
// the 25th is a weekend or a Japanese holiday — and there's no notification
// when it does. So from the real credit date, the app asks once: how much did
// you get, and were any approved reimbursements bundled inside it?
//
// Whatever's ticked as "included" is settled the salary way: the claim moves to
// paid with NO separate income record, because the salary figure you enter
// already contains that money. Booking it twice would inflate the month — this
// is the tally the reconcile keeps honest.
export default function SalaryDayCard() {
  const { settings, save } = useSettings()
  const claims = useCollection('commuteClaims')
  const batchOps = useBatchOps()
  const { toast } = useToast()

  const status = salaryStatus(settings)
  const accounts = settings?.accounts || []

  const [amount, setAmount] = useState(
    settings?.salaryAmount ? String(settings.salaryAmount) : ''
  )
  const [account, setAccount] = useState('')
  const [checked, setChecked] = useState(null) // Set of claim ids; null = default-all
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showClaims, setShowClaims] = useState(false)

  // Approved-but-not-yet-paid claims are the ones that could be inside this pay.
  const approved = useMemo(
    () => claims.data.filter((c) => claimStage(c) === 'approved'),
    [claims.data]
  )

  // Default: assume every approved claim is included (the usual case).
  const isChecked = (id) => (checked === null ? true : checked.has(id))
  const toggle = (id) =>
    setChecked((prev) => {
      const next = new Set(prev === null ? approved.map((c) => c.id) : prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (!status.due || status.alreadyLogged || claims.loading) return null

  const amountNum = parseFloat(amount) || 0
  const includedClaims = approved.filter((c) => isChecked(c.id))
  const includedTotal = includedClaims.reduce((s, c) => s + (claimApproved(c) || 0), 0)
  const basePay = amountNum - includedTotal
  const overClaimed = includedTotal > amountNum + 0.5

  const defaultAccount = account || accounts.find((a) => a.country === 'JP')?.label || ''

  const handleSave = async () => {
    if (amountNum <= 0) {
      setError('Enter how much salary landed.')
      return
    }
    if (overClaimed) {
      setError("The reimbursements ticked add up to more than the salary — untick some.")
      return
    }
    setSaving(true)
    setError('')
    try {
      const ops = [
        {
          op: 'set',
          name: 'income',
          data: {
            amount: amountNum,
            source: 'Salary',
            gross: null,
            net: null,
            account: defaultAccount || null,
            country: 'JP', // salary is paid in yen
            date: status.payDate,
            note: includedTotal > 0 ? `Includes ${formatJPY(includedTotal)} reimbursement` : '',
          },
        },
        // Each included claim → paid via salary, NO separate income (already in
        // the salary figure above), so nothing is counted twice.
        ...includedClaims.map((c) => ({
          op: 'update',
          name: 'commuteClaims',
          id: c.id,
          data: {
            status: 'paid',
            approvedAmount: claimApproved(c),
            incomeId: null,
            receivedVia: 'salary',
            paidAt: status.payDate,
          },
        })),
      ]
      await batchOps(ops)
      await save({ salaryLoggedMonth: status.monthKey })
      toast(
        includedTotal > 0
          ? `💴 ${formatJPY(amountNum)} salary logged · ${formatJPY(includedTotal)} reimbursement tallied in`
          : `💴 ${formatJPY(amountNum)} salary logged`
      )
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  const dismiss = () => save({ salaryLoggedMonth: status.monthKey })

  return (
    <div className="card space-y-3 border-l-4 border-l-emerald-500 p-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          💴 Salary day — how much did you get?
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Credited {status.payDate.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          {approved.length > 0 && ` · ${approved.length} approved reimbursement${approved.length === 1 ? '' : 's'} may be inside it`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Salary received (¥)
          <input
            type="number"
            step="any"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input"
          />
        </label>
        {accounts.length > 0 && (
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Into account
            <select
              value={defaultAccount}
              onChange={(e) => setAccount(e.target.value)}
              className="input"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.label}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* The reimbursement tally — which approved claims are inside this pay */}
      {approved.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700">
          <button
            type="button"
            onClick={() => setShowClaims((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
          >
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
              Reimbursements included
            </span>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              {formatJPY(includedTotal)} · {showClaims ? 'hide' : 'edit'}
            </span>
          </button>
          {showClaims && (
            <div className="space-y-1 border-t border-gray-200 px-3 py-2 dark:border-neutral-700">
              {approved.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2.5 py-1 text-sm text-gray-700 dark:text-gray-200"
                >
                  <input
                    type="checkbox"
                    checked={isChecked(c.id)}
                    onChange={() => toggle(c.id)}
                    className="h-4 w-4 rounded accent-emerald-600"
                  />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatJPY(claimApproved(c) || 0)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The reconcile, spelled out so the count is never a mystery */}
      {amountNum > 0 && includedTotal > 0 && !overClaimed && (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
          {formatJPY(amountNum)} = base pay {formatJPY(basePay)} + {formatJPY(includedTotal)}{' '}
          reimbursement ({includedClaims.length} claim{includedClaims.length === 1 ? '' : 's'}) —
          those claims are marked paid, with nothing double-counted.
        </p>
      )}

      {overClaimed && (
        <p className="text-xs text-red-600 dark:text-red-400">
          The ticked reimbursements ({formatJPY(includedTotal)}) exceed the salary — untick any that
          were paid separately.
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="btn-primary min-h-11 flex-1 text-sm"
        >
          {saving ? 'Saving…' : 'Log salary'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 shrink-0 px-3 text-xs font-medium text-gray-500 active:scale-95 dark:text-gray-400"
        >
          Skip
        </button>
      </div>
      {approved.length > 0 && (
        <Link
          to="/reimbursements"
          className="block text-[11px] font-medium text-indigo-600 dark:text-indigo-400"
        >
          Some paid separately instead? Settle them in Claims →
        </Link>
      )}
    </div>
  )
}
