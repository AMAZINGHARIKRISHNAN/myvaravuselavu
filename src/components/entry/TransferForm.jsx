import { useState } from 'react'
import { useCollectionWriters } from '../../hooks/useCollectionWriters'
import { useSettings } from '../../hooks/useSettings'
import { useToast } from '../../context/ToastContext'
import { toDateInputValue, parseDateInput } from '../../lib/format'
import { celebrate } from '../../lib/celebrate'
import BottomSheet from '../ui/BottomSheet'

export default function TransferForm({ onClose, initial }) {
  const { add, update } = useCollectionWriters('transfers')
  const { settings } = useSettings()
  const jpAccounts = (settings?.accounts || []).filter((a) => a.country === 'JP')
  const { toast } = useToast()
  const [amountSent, setAmountSent] = useState(initial?.amountSent ?? '')
  const [amountReceived, setAmountReceived] = useState(initial?.amountReceived ?? '')
  const [exchangeRate, setExchangeRate] = useState(initial?.exchangeRate ?? '')
  const [fee, setFee] = useState(initial?.fee ?? '')
  const [date, setDate] = useState(toDateInputValue(initial?.date))
  const [recipient, setRecipient] = useState(initial?.recipient ?? 'Parents')
  const [method, setMethod] = useState(initial?.method ?? 'Wise')
  const [fromAccount, setFromAccount] = useState(initial?.fromAccount ?? '')
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
        date: parseDateInput(date),
        recipient,
        method,
        fromAccount: fromAccount || null,
        note,
      }
      if (initial?.id) {
        await update(initial.id, payload)
      } else {
        await add(payload)
        celebrate()
      }
      toast(`✓ Transfer of ¥${sent.toLocaleString()} saved`)
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
      title={initial ? 'Edit transfer' : 'Add transfer'}
    >
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
          {jpAccounts.length > 0 && (
            <Field label="From account (for balances)">
              <select value={fromAccount} onChange={(e) => setFromAccount(e.target.value)} className="input">
                <option value="">— none —</option>
                {jpAccounts.map((a) => (
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
        {saving ? 'Saving…' : 'Save transfer'}
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
