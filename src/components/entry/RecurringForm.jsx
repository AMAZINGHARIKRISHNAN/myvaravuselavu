import { useState } from 'react'
import { useRecurring } from '../../hooks/useRecurring'
import { useSettings } from '../../hooks/useSettings'
import { useToast } from '../../context/ToastContext'
import { CATEGORIES, NON_ACCOUNT_PAYMENT_METHODS } from '../../lib/constants'
import BottomSheet from '../ui/BottomSheet'

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
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      as="form"
      onSubmit={handleSubmit}
      onClose={onClose}
      title={initial ? 'Edit recurring' : 'New recurring'}
    >
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="grid grid-cols-3 gap-2">
          {['expense', 'income', 'transfer'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-xl py-2 text-sm font-medium capitalize transition-transform active:scale-95 ${
                kind === k
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
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
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              The exchange rate is filled in from the live rate when this posts — check and edit it afterward.
            </p>
          </>
        )}

        <label className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-neutral-800/50">
          <span className="text-xs text-gray-600 dark:text-gray-300">
            Auto-post on due date
            <span className="block text-[11px] text-gray-500 dark:text-gray-400">
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
    </BottomSheet>
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
