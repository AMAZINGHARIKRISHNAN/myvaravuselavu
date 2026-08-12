import { useState } from 'react'
import { useRecurring } from '../../hooks/useRecurring'
import { useSettings } from '../../hooks/useSettings'
import { useToast } from '../../context/ToastContext'
import { CATEGORIES, NON_ACCOUNT_PAYMENT_METHODS } from '../../lib/constants'
import { sourceCountry } from '../../lib/currencyAudit'
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
  // Optional shop for recurring expenses (landlord, gym, provider) so the
  // auto-posted bill lands in the store ranking like any other spend.
  const [store, setStore] = useState(initial?.store ?? '')
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

  // Method and country used to be two free choices side by side, so a bill
  // could be saved as "Edenred, IN" — and unlike a one-off mistake this one
  // reposts itself every month, generating a rupee expense on a yen card
  // forever. A method that can only hold one currency now decides it, and the
  // dropdown disappears rather than offering a choice that is already made.
  const fixedCountry = sourceCountry(paymentMethod, settings?.accounts ?? [])
  const effectiveCountry = fixedCountry || country

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
          ? { category, paymentMethod, country: effectiveCountry, store: store.trim() }
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
              className={`rounded-xl border py-2 text-sm font-medium capitalize transition-transform active:scale-95 ${
                kind === k
                  ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                  : 'border-gray-300/60 bg-gray-100 text-gray-600 dark:border-transparent dark:bg-neutral-800 dark:text-gray-300'
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

        {/* 29, 30 and 31 don't exist in every month — say what happens instead
            of leaving it to be discovered in February. */}
        {parseInt(dayOfMonth, 10) > 28 && (
          <p className="-mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            Day {parseInt(dayOfMonth, 10)} means month end: it posts on the 30th in April and the
            28th in February, dated the day the money actually moves.
          </p>
        )}

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
            {/* Only Cash can be either — every other method names its own
                currency, so asking would just be a way to get it wrong. */}
            {fixedCountry ? (
              <Field label="Country">
                <p className="flex min-h-11 items-center px-1 text-xs text-gray-500 dark:text-gray-400">
                  {fixedCountry} — set by {paymentMethod}
                </p>
              </Field>
            ) : (
              <Field label="Country">
                <select value={country} onChange={(e) => setCountry(e.target.value)} className="input">
                  <option value="JP">JP</option>
                  <option value="IN">IN</option>
                </select>
              </Field>
            )}
          </div>
        )}

        {kind === 'expense' && (
          <Field label="Store / payee (optional)">
            <input
              value={store}
              onChange={(e) => setStore(e.target.value)}
              placeholder="e.g. Landlord, Softbank"
              className="input"
            />
          </Field>
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

        <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-100/80 px-3 py-2.5 dark:border-transparent dark:bg-neutral-800/50">
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
