import { useState } from 'react'
import { useCollection } from '../../hooks/useCollection'
import { useToast } from '../../context/ToastContext'

function todayInputValue() {
  return new Date().toISOString().slice(0, 10)
}

export default function IncomeForm({ onClose, initial }) {
  const { add, update } = useCollection('income')
  const { toast } = useToast()
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [source, setSource] = useState(initial?.source ?? 'Salary')
  const [gross, setGross] = useState(initial?.gross ?? '')
  const [net, setNet] = useState(initial?.net ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [date, setDate] = useState(
    initial?.date ? initial.date.toDate().toISOString().slice(0, 10) : todayInputValue()
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!amount) {
      setError('Amount is required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        amount: parseFloat(amount),
        source,
        gross: gross ? parseFloat(gross) : null,
        net: net ? parseFloat(net) : null,
        note,
        date: new Date(date),
      }
      if (initial?.id) {
        await update(initial.id, payload)
      } else {
        await add(payload)
      }
      toast(`✓ Income of ¥${payload.amount.toLocaleString()} saved`)
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
            {initial ? 'Edit income' : 'Add income'}
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
          <Field label="Amount (JPY)">
            <input type="number" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          </Field>
          <Field label="Source">
            <input value={source} onChange={(e) => setSource(e.target.value)} className="input" />
          </Field>
          <Field label="Gross">
            <input type="number" step="any" value={gross} onChange={(e) => setGross(e.target.value)} className="input" />
          </Field>
          <Field label="Net">
            <input type="number" step="any" value={net} onChange={(e) => setNet(e.target.value)} className="input" />
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </Field>
        </div>
        <Field label="Note">
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
        </Field>

        <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
          {saving ? 'Saving…' : 'Save income'}
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
