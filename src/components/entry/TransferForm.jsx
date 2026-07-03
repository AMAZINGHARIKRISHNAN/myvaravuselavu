import { useState } from 'react'
import { useCollection } from '../../hooks/useCollection'
import { useToast } from '../../context/ToastContext'

function todayInputValue() {
  return new Date().toISOString().slice(0, 10)
}

export default function TransferForm({ onClose, initial }) {
  const { add, update } = useCollection('transfers')
  const { toast } = useToast()
  const [amountSent, setAmountSent] = useState(initial?.amountSent ?? '')
  const [amountReceived, setAmountReceived] = useState(initial?.amountReceived ?? '')
  const [exchangeRate, setExchangeRate] = useState(initial?.exchangeRate ?? '')
  const [fee, setFee] = useState(initial?.fee ?? '')
  const [date, setDate] = useState(
    initial?.date ? initial.date.toDate().toISOString().slice(0, 10) : todayInputValue()
  )
  const [recipient, setRecipient] = useState(initial?.recipient ?? 'Parents')
  const [method, setMethod] = useState(initial?.method ?? 'Wise')
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    const sent = parseFloat(amountSent)
    const received = parseFloat(amountReceived)
    if (!sent || !received) {
      setError('Amount sent and amount received are required.')
      return
    }
    const rate = exchangeRate ? parseFloat(exchangeRate) : received / sent

    setSaving(true)
    setError('')
    try {
      const payload = {
        amountSent: sent,
        amountReceived: received,
        exchangeRate: rate,
        fee: parseFloat(fee) || 0,
        date: new Date(date),
        recipient,
        method,
        note,
      }
      if (initial?.id) {
        await update(initial.id, payload)
      } else {
        await add(payload)
      }
      toast(`✓ Transfer of ¥${sent.toLocaleString()} saved`)
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
            {initial ? 'Edit transfer' : 'Add transfer'}
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount sent (JPY)">
            <input
              type="number"
              step="any"
              required
              value={amountSent}
              onChange={(e) => setAmountSent(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Amount received (INR)">
            <input
              type="number"
              step="any"
              required
              value={amountReceived}
              onChange={(e) => setAmountReceived(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Exchange rate (auto if blank)">
            <input
              type="number"
              step="any"
              placeholder="auto"
              value={exchangeRate}
              onChange={(e) => setExchangeRate(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Fee (JPY)">
            <input
              type="number"
              step="any"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </Field>
          <Field label="Recipient">
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} className="input" />
          </Field>
          <Field label="Method">
            <input value={method} onChange={(e) => setMethod(e.target.value)} className="input" />
          </Field>
        </div>
        <Field label="Note">
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
        </Field>

        <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
          {saving ? 'Saving…' : 'Save transfer'}
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
