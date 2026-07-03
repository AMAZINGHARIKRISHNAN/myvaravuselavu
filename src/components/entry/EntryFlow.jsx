import { useEffect, useState } from 'react'
import Keypad from './Keypad'
import CategoryGrid from './CategoryGrid'
import PaymentMethodGrid from './PaymentMethodGrid'
import { useSettings } from '../../hooks/useSettings'
import { useCollection } from '../../hooks/useCollection'
import { useToast } from '../../context/ToastContext'
import { formatByCountry } from '../../lib/format'

const STEPS = ['amount', 'category', 'payment', 'confirm']
const STEP_LABELS = { amount: 'Amount', category: 'Category', payment: 'Payment', confirm: 'Confirm' }

export default function EntryFlow({ initial, onClose, onSaved }) {
  const { settings } = useSettings()
  const { add, update } = useCollection('expenses')
  const { toast } = useToast()

  const [stepIndex, setStepIndex] = useState(initial ? STEPS.length - 1 : 0)
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : '0')
  const [category, setCategory] = useState(initial?.category || null)
  const [paymentMethod, setPaymentMethod] = useState(initial?.paymentMethod || null)
  const [country, setCountry] = useState(initial?.country || null)
  const [note, setNote] = useState(initial?.note || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const step = STEPS[stepIndex]
  const accounts = settings?.accounts || []

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

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
      }
      if (initial?.id) {
        await update(initial.id, payload)
      } else {
        await add({ ...payload, date: new Date() })
      }
      toast(`✓ ${formatByCountry(payload.amount, payload.country)} · ${category} saved`)
      onSaved?.()
      onClose()
    } catch (err) {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 animate-[fade-in_0.15s_ease-out]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-5 space-y-5 max-h-[92svh] overflow-y-auto dark:bg-neutral-900 dark:border dark:border-neutral-800 animate-[sheet-up_0.22s_cubic-bezier(0.32,0.72,0,1)] shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1 text-sm font-medium text-gray-500 transition-transform active:scale-90 dark:text-gray-400"
          >
            {stepIndex === 0 ? 'Cancel' : '← Back'}
          </button>

          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500">
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
                  ? 'bg-gradient-to-r from-indigo-500 to-fuchsia-500'
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
            <div className="text-center gradient-text text-4xl font-bold">
              {formatByCountry(parseFloat(amount) || 0, country)}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <button
                type="button"
                onClick={() => setStepIndex(1)}
                className="rounded-xl bg-gray-100 px-3 py-2 text-left dark:bg-neutral-800"
              >
                <span className="block text-xs text-gray-400 dark:text-gray-500">Category</span>
                <span className="dark:text-gray-100">{category || 'Select'}</span>
              </button>
              <button
                type="button"
                onClick={() => setStepIndex(2)}
                className="rounded-xl bg-gray-100 px-3 py-2 text-left dark:bg-neutral-800"
              >
                <span className="block text-xs text-gray-400 dark:text-gray-500">Payment</span>
                <span className="dark:text-gray-100">{paymentMethod || 'Select'}</span>
              </button>
            </div>
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
              disabled={saving || !category || !paymentMethod || !parseFloat(amount)}
              onClick={handleSave}
              className="btn-primary w-full py-3 text-sm"
            >
              {saving ? 'Saving…' : 'Save expense'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
