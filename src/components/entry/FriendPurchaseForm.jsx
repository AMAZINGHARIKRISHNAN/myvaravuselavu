import { useState } from 'react'
import { useCollectionWriters } from '../../hooks/useCollectionWriters'
import { useToast } from '../../context/ToastContext'
import { toDateInputValue, parseDateInput, formatByCountry } from '../../lib/format'
import { celebrate } from '../../lib/celebrate'
import BottomSheet from '../ui/BottomSheet'

// Logs an item bought on a friend's behalf. Four money fields:
//   cost     — what the item costs you (you have to give)
//   paid     — what you've actually paid so far (blank = full cost)
//   due      — what the friend should give you back (blank = cost, no markup)
//   received — what the friend has given you so far
export default function FriendPurchaseForm({ onClose, initial, friendNames = [] }) {
  const { add, update } = useCollectionWriters('friendPurchases')
  const { toast } = useToast()
  const [item, setItem] = useState(initial?.item ?? '')
  const [friend, setFriend] = useState(initial?.friend ?? '')
  const [country, setCountry] = useState(initial?.country ?? 'JP')
  const [cost, setCost] = useState(initial?.cost ?? '')
  const [paid, setPaid] = useState(initial?.paid ?? '')
  const [due, setDue] = useState(initial?.due ?? '')
  const [received, setReceived] = useState(initial?.received ?? '')
  const [date, setDate] = useState(toDateInputValue(initial?.date))
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const costNum = parseFloat(cost) || 0
  const dueNum = due === '' ? costNum : parseFloat(due) || 0
  // Projected profit/loss = what they'll give back minus what actually left
  // your pocket (paid, which defaults to the full cost when blank).
  const paidNum = paid === '' ? costNum : parseFloat(paid) || 0
  const markup = dueNum - paidNum

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!item.trim() || !friend.trim()) {
      setError('Item and friend name are required.')
      return
    }
    if (!costNum) {
      setError('Cost is required.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        item: item.trim(),
        friend: friend.trim(),
        country,
        cost: costNum,
        paid: paid === '' ? costNum : parseFloat(paid) || 0,
        due: dueNum,
        received: parseFloat(received) || 0,
        date: parseDateInput(date),
        note,
      }
      if (initial?.id) {
        await update(initial.id, payload)
      } else {
        await add(payload)
        celebrate()
      }
      toast(`✓ ${item.trim()} for ${friend.trim()} saved`)
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
      title={initial ? 'Edit friend purchase' : 'Bought for a friend'}
    >
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Field label="What did you buy?">
        <input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="e.g. Headphones"
          required
          className="input"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="For which friend?">
          <input
            value={friend}
            onChange={(e) => setFriend(e.target.value)}
            list="friend-names"
            placeholder="Name"
            required
            className="input"
          />
          <datalist id="friend-names">
            {friendNames.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
        <Field label="Currency">
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="input">
            <option value="JP">¥ JPY</option>
            <option value="IN">₹ INR</option>
          </select>
        </Field>
        <Field label="Your cost (you have to give)">
          <input
            type="number"
            step="any"
            required
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="You've paid so far (blank = full)">
          <input
            type="number"
            step="any"
            placeholder="= cost"
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Friend owes you (blank = cost)">
          <input
            type="number"
            step="any"
            placeholder="= cost"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Friend paid so far">
          <input
            type="number"
            step="any"
            placeholder="0"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
        <Field label="Note">
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
        </Field>
      </div>

      {costNum > 0 && markup !== 0 && (
        <p
          className={`text-xs font-medium ${
            markup > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
          }`}
        >
          {markup > 0
            ? `You'll make ${formatByCountry(markup, country)} on this when settled 🟢`
            : `You're covering ${formatByCountry(Math.abs(markup), country)} of this yourself`}
        </p>
      )}

      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : 'Save purchase'}
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
