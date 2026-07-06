import { useState } from 'react'
import Keypad from './Keypad'
import CategoryGrid from './CategoryGrid'
import PaymentMethodGrid from './PaymentMethodGrid'
import BottomSheet from '../ui/BottomSheet'
import { useSettings } from '../../hooks/useSettings'
import { useCollectionWriters } from '../../hooks/useCollectionWriters'
import { useToast } from '../../context/ToastContext'
import { formatByCountry, toDate, toDateInputValue, parseDateInput } from '../../lib/format'
import { celebrate } from '../../lib/celebrate'

const STEPS = ['amount', 'category', 'payment', 'confirm']
const STEP_LABELS = { amount: 'Amount', category: 'Category', payment: 'Payment', confirm: 'Confirm' }
const LAST_PAYMENT_KEY = 'vs_last_payment'

function loadLastPayment() {
  try {
    return JSON.parse(localStorage.getItem(LAST_PAYMENT_KEY) || 'null')
  } catch {
    return null
  }
}

export default function EntryFlow({ initial, onClose, onSaved }) {
  const { settings } = useSettings()
  const { add, update } = useCollectionWriters('expenses')
  const { toast } = useToast()

  // For new entries, preselect the last-used payment method so step 3 is a confirm-tap.
  const lastPayment = initial?.id ? null : loadLastPayment()

  const [stepIndex, setStepIndex] = useState(initial ? STEPS.length - 1 : 0)
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : '0')
  const [category, setCategory] = useState(initial?.category || null)
  const [paymentMethod, setPaymentMethod] = useState(
    initial?.paymentMethod || lastPayment?.paymentMethod || null
  )
  const [country, setCountry] = useState(initial?.country || lastPayment?.country || null)
  const [note, setNote] = useState(initial?.note || '')
  const [dateStr, setDateStr] = useState(
    initial?.date ? toDateInputValue(toDate(initial.date)) : toDateInputValue(new Date())
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const step = STEPS[stepIndex]
  const accounts = settings?.accounts || []

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  const goBack = () => {
    if (stepIndex === 0) {
      onClose()
    } else {
      setStepIndex((i) => i - 1)
    }
  }

  const handleSelectPayment = (opt) => {
    setPaymentMethod(opt.label)
    if (opt.country) {
      setCountry(opt.country)
      goNext()
    } else if (country) {
      // country already chosen for this non-account method — advance
      goNext()
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        amount: parseFloat(amount),
        category,
        country: country || 'JP',
        paymentMethod,
        note,
        date: parseDateInput(dateStr),
      }
      if (initial?.id) {
        await update(initial.id, payload)
      } else {
        await add(payload)
        celebrate()
      }
      localStorage.setItem(
        LAST_PAYMENT_KEY,
        JSON.stringify({ paymentMethod, country: payload.country })
      )
      toast(`✓ ${formatByCountry(payload.amount, payload.country)} · ${category} saved`)
      onSaved?.()
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1 text-sm font-medium text-gray-500 transition-transform active:scale-90 dark:text-gray-400"
        >
          {stepIndex === 0 ? 'Cancel' : '← Back'}
        </button>

        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
          {STEP_LABELS[step]}
          <span className="text-gray-300 dark:text-neutral-600"> · {stepIndex + 1}/{STEPS.length}</span>
        </span>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-transform active:scale-90 dark:bg-neutral-800 dark:text-gray-400"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-1.5">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
              i <= stepIndex
                ? 'bg-indigo-500'
                : 'bg-gray-200 dark:bg-neutral-700'
            }`}
          />
        ))}
      </div>

      {step === 'amount' && <Keypad value={amount} onChange={setAmount} onNext={goNext} />}

      {step === 'category' && (
        <>
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">Category</h2>
          <CategoryGrid
            value={category}
            onSelect={(c) => {
              setCategory(c)
              goNext()
            }}
          />
        </>
      )}

      {step === 'payment' && (
        <>
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            Payment method
          </h2>
          <PaymentMethodGrid
            accounts={accounts}
            value={paymentMethod}
            country={country}
            onSelect={handleSelectPayment}
          />
        </>
      )}

      {step === 'confirm' && (
        <div className="space-y-4 w-full max-w-xs mx-auto">
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">Confirm</h2>
          <div className="text-center text-4xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {formatByCountry(parseFloat(amount) || 0, country)}
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <button
              type="button"
              onClick={() => setStepIndex(1)}
              className="rounded-xl bg-gray-100 px-3 py-2 text-left dark:bg-neutral-800"
            >
              <span className="block text-xs text-gray-500 dark:text-gray-400">Category</span>
              <span className="dark:text-gray-100">{category || 'Select'}</span>
            </button>
            <button
              type="button"
              onClick={() => setStepIndex(2)}
              className="rounded-xl bg-gray-100 px-3 py-2 text-left dark:bg-neutral-800"
            >
              <span className="block text-xs text-gray-500 dark:text-gray-400">Payment</span>
              <span className="dark:text-gray-100">{paymentMethod || 'Select'}</span>
            </button>
          </div>
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Date
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="input"
            />
          </label>
          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            disabled={saving || !category || !paymentMethod || !parseFloat(amount) || !dateStr}
            onClick={handleSave}
            className="btn-primary w-full py-3 text-sm"
          >
            {saving ? 'Saving…' : 'Save expense'}
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
