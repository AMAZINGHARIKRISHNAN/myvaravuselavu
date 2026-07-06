import { useState } from 'react'
import { useCollectionWriters } from '../../hooks/useCollectionWriters'
import { useSettings } from '../../hooks/useSettings'
import { useToast } from '../../context/ToastContext'
import { toDateInputValue, parseDateInput } from '../../lib/format'
import { celebrate } from '../../lib/celebrate'
import BottomSheet from '../ui/BottomSheet'

export default function IncomeForm({ onClose, initial }) {
  const { add, update } = useCollectionWriters('income')
  const { settings } = useSettings()
  const accounts = settings?.accounts || []
  const { toast } = useToast()
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [source, setSource] = useState(initial?.source ?? 'Salary')
  const [account, setAccount] = useState(initial?.account ?? '')
  const [gross, setGross] = useState(initial?.gross ?? '')
  const [net, setNet] = useState(initial?.net ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [date, setDate] = useState(toDateInputValue(initial?.date))
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
        account: account || null,
        date: parseDateInput(date),
      }
      if (initial?.id) {
        await update(initial.id, payload)
      } else {
        await add(payload)
        celebrate()
      }
      toast(`✓ Income of ¥${payload.amount.toLocaleString()} saved`)
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
      title={initial ? 'Edit income' : 'Add income'}
    >
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
        {accounts.length > 0 && (
          <Field label="Deposited to (for balances)">
            <select value={account} onChange={(e) => setAccount(e.target.value)} className="input">
              <option value="">— none —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.label}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Field label="Note">
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
      </Field>

      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : 'Save income'}
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
