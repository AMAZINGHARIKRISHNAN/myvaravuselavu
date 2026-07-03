import { useEffect, useState } from 'react'
import { useRecurring } from '../../hooks/useRecurring'
import { useSettings } from '../../hooks/useSettings'
import { useToast } from '../../context/ToastContext'
import { CATEGORIES, NON_ACCOUNT_PAYMENT_METHODS } from '../../lib/constants'

export default function RecurringForm({ onClose, initial }) {
  const { add, update } = useRecurring()
  const { settings } = useSettings()
  const { toast } = useToast()
  const [kind, setKind] = useState(initial?.kind ?? 'expense')
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [dayOfMonth, setDayOfMonth] = useState(initial?.dayOfMonth ?? 1)
  const [category, setCategory] = useState(initial?.category ?? 'Bills')
  const [paymentMethod, setPaymentMethod] = useState(initial?.paymentMethod ?? 'Cash')
  const [country, setCountry] = useState(initial?.country ?? 'JP')
  const [source, setSource] = useState(initial?.source ?? 'Salary')
  const [recipient, setRecipient] = useState(initial?.recipient ?? 'Parents')
  const [method, setMethod] = useState(initial?.method ?? 'Wise')
  const [fee, setFee] = useState(initial?.fee ?? '')
  const [autoPost, setAutoPost] = useState(initial?.autoPost ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const paymentOptions = [
    ...(settings?.accounts ?? []).map((a) => a.label),
    ...NON_ACCOUNT_PAYMENT_METHODS,
  ]

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!amount || !label.trim()) {
      setError('Amount and label are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        kind,
        amount: parseFloat(amount),
        label: label.trim(),
        dayOfMonth: Math.min(Math.max(parseInt(dayOfMonth, 10) || 1, 1), 31),
        active: initial?.active ?? true,
        autoPost,
        lastGeneratedMonth: initial?.lastGeneratedMonth ?? null,
        ...(kind === 'expense'
          ? { category, paymentMethod, country }
          : kind === 'transfer'
            ? { recipient, method, fee: parseFloat(fee) || 0 }
            : { source }),
      }
      if (initial?.id) {
        await update(initial.id, payload)
      } else {
        await add(payload)
      }
      toast(`✓ Recurring "${payload.label}" saved`)
      onClose()
    } catch (err) {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 animate-[fade-in_0.15s_ease-out]"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-5 space-y-4 max-h-[92svh] overflow-y-auto dark:bg-neutral-900 dark:border dark:border-neutral-800 animate-[sheet-up_0.22s_cubic-bezier(0.32,0.72,0,1)] shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {initial ? 'Edit recurring' : 'New recurring'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-transform active:scale-90 dark:bg-neutral-800 dark:text-gray-400"
          >
            ✕
          </button>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="grid grid-cols-3 gap-2">
          {['expense', 'income', 'transfer'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-xl py-2 text-sm font-medium capitalize transition-transform active:scale-95 ${
                kind === k
                  ? 'bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white'
                  : 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-gray-300'
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <Field label={kind === 'transfer' ? 'Label (e.g. Monthly remittance)' : 'Label (e.g. Rent, Netflix)'}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="input" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === 'transfer' ? 'Amount to send (JPY)' : 'Amount (JPY)'}>
            <input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Day of month">
            <input
              type="number"
              min="1"
              max="31"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
              className="input"
            />
          </Field>
        </div>

        {kind === 'expense' && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Method">
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="input"
              >
                {paymentOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Country">
              <select value={country} onChange={(e) => setCountry(e.target.value)} className="input">
                <option value="JP">JP</option>
                <option value="IN">IN</option>
              </select>
            </Field>
          </div>
        )}

        {kind === 'income' && (
          <Field label="Source">
            <input value={source} onChange={(e) => setSource(e.target.value)} className="input" />
          </Field>
        )}

        {kind === 'transfer' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Recipient">
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} className="input" />
              </Field>
              <Field label="Method">
                <input value={method} onChange={(e) => setMethod(e.target.value)} className="input" />
              </Field>
            </div>
            <Field label="Fee (JPY, optional)">
              <input type="number" step="any" value={fee} onChange={(e) => setFee(e.target.value)} className="input" />
            </Field>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              The exchange rate is filled in from the live rate when this posts — check and edit it afterward.
            </p>
          </>
        )}

        <label className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-neutral-800/50">
          <span className="text-xs text-gray-600 dark:text-gray-300">
            Auto-post on due date
            <span className="block text-[11px] text-gray-400 dark:text-gray-500">
              Skip the "Due this month" confirmation
            </span>
          </span>
          <input
            type="checkbox"
            checked={autoPost}
            onChange={(e) => setAutoPost(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
        </label>

        <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
          {saving ? 'Saving…' : 'Save recurring'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
      {label}
      {children}
    </label>
  )
}
