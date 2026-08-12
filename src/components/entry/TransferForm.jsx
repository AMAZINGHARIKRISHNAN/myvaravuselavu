import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCollectionWriters } from '../../hooks/useCollectionWriters'
import { useSettings } from '../../hooks/useSettings'
import { useToast } from '../../context/ToastContext'
import { toDateTimeInputValue, parseDateTimeInput, formatByCountry } from '../../lib/format'
import { celebrate } from '../../lib/celebrate'
import BottomSheet from '../ui/BottomSheet'

export default function TransferForm({ onClose, initial }) {
  const { add, update } = useCollectionWriters('transfers')
  const { settings } = useSettings()
  const allAccounts = settings?.accounts || []
  const { toast } = useToast()
  const [amountSent, setAmountSent] = useState(initial?.amountSent ?? '')
  const [amountReceived, setAmountReceived] = useState(initial?.amountReceived ?? '')
  const [exchangeRate, setExchangeRate] = useState(initial?.exchangeRate ?? '')
  const [fee, setFee] = useState(initial?.fee ?? '')
  const [date, setDate] = useState(toDateTimeInputValue(initial?.date))
  const [recipient, setRecipient] = useState(initial?.recipient ?? 'Parents')
  // Where the money actually landed — a bank name/account or a UPI id — so a
  // transfer is traceable to the exact destination, not just the person.
  const [recipientDetails, setRecipientDetails] = useState(initial?.recipientDetails ?? '')
  const [method, setMethod] = useState(initial?.method ?? 'Wise')
  const [fromAccount, setFromAccount] = useState(initial?.fromAccount ?? '')
  const [toAccount, setToAccount] = useState(initial?.toAccount ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Where each end of this transfer lives. When both are in the same country
  // no currency changed, so the exchange-rate machinery does not apply.
  const fromCountry = allAccounts.find((a) => a.label === fromAccount)?.country || null
  const toCountry = allAccounts.find((a) => a.label === toAccount)?.country || null
  const sameCurrency = Boolean(fromCountry && toCountry && fromCountry === toCountry)

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
        date: parseDateTimeInput(date),
        recipient,
        recipientDetails: recipientDetails.trim(),
        method,
        fromAccount: fromAccount || null,
        // Self transfer: the received rupees land here and credit that balance.
        toAccount: toAccount || null,
        note,
      }
      if (initial?.id) {
        await update(initial.id, payload)
      } else {
        await add(payload)
        celebrate()
      }
      toast(
        toAccount
          ? `✓ ¥${sent.toLocaleString()} sent · ₹${received.toLocaleString()} into ${toAccount}`
          : `✓ Transfer of ¥${sent.toLocaleString()} saved`
      )
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
          <Field label="Amount sent (JPY) — total charged">
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
          <Field label="Of that, the fee (JPY)">
            <input
              type="number"
              step="any"
              placeholder="Wise fee"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Date & time">
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Method">
            <input value={method} onChange={(e) => setMethod(e.target.value)} className="input" />
          </Field>
          <Field label="Recipient">
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} className="input" />
          </Field>
          <Field label="Bank / UPI details">
            <input
              value={recipientDetails}
              onChange={(e) => setRecipientDetails(e.target.value)}
              placeholder="e.g. ICICI ••1234 or name@upi"
              className="input"
            />
          </Field>
          {allAccounts.length > 0 && (
            <Field label="From account (for balances)">
              {/* EVERY account, not only the Japanese ones. Listing JP alone
                  meant a rupee-to-rupee self transfer had no selectable source,
                  so nothing was ever debited and the money appeared to arrive
                  from thin air — or, with no received figure either, to vanish
                  entirely. */}
              <select value={fromAccount} onChange={(e) => setFromAccount(e.target.value)} className="input">
                <option value="">— none —</option>
                {allAccounts
                  .filter((a) => a.label !== toAccount)
                  .map((a) => (
                    <option key={a.id} value={a.label}>
                      {a.country === 'IN' ? '🇮🇳' : '🇯🇵'} {a.label}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {/* Sent to yourself: every account you own is listed (Indian ones
              first — that's where a remittance lands), minus the one it's
              leaving from. With no accounts at all, point at Settings. */}
          <Field label="To my own account (self transfer)">
            {allAccounts.length > 0 ? (
              <select value={toAccount} onChange={(e) => setToAccount(e.target.value)} className="input">
                <option value="">— sent to someone else —</option>
                {[...allAccounts]
                  .sort((a, b) => (a.country === 'IN' ? -1 : 0) - (b.country === 'IN' ? -1 : 0))
                  .filter((a) => a.label !== fromAccount)
                  .map((a) => (
                    <option key={a.id} value={a.label}>
                      {a.country === 'IN' ? '🇮🇳' : '🇯🇵'} {a.label}
                    </option>
                  ))}
              </select>
            ) : (
              <Link
                to="/settings"
                className="flex min-h-11 items-center rounded-xl border border-dashed border-gray-500/40 px-3 text-[11px] text-indigo-500 dark:text-indigo-400"
              >
                Add your accounts in Settings →
              </Link>
            )}
          </Field>
      </div>
      {/* The one thing that used to be guessed wrong: Wise takes its cut out of
          what you hand over, so the account drops by the amount sent and no
          more. Say so where the number is typed. */}
      {fromAccount && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          {/* In the account's OWN currency: a rupee-to-rupee self transfer was
              labelled in yen, which is the one place a number must not lie. */}
          {fromAccount} goes down by {formatByCountry(parseFloat(amountSent) || 0, fromCountry)}
          {parseFloat(fee) > 0 &&
            ` — the ${formatByCountry(parseFloat(fee) || 0, fromCountry)} fee is inside that, not on top`}
          .
        </p>
      )}
      {toAccount && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          {toAccount} goes up by{' '}
          {sameCurrency
            ? `${toCountry === 'IN' ? '₹' : '¥'}${(parseFloat(amountSent) || 0).toLocaleString()}`
            : toCountry === 'JP'
              ? `¥${(parseFloat(amountSent) || 0).toLocaleString()}`
              : `₹${(parseFloat(amountReceived) || 0).toLocaleString()}`}{' '}
          — it's still your money, so it shows as a balance, never as income.
        </p>
      )}

      {/* No currency changed, so there is no rate and nothing was "received"
          separately — what left is what arrived. Saying so stops the received
          and rate boxes being filled with a number that means nothing. */}
      {sameCurrency && (
        <p className="rounded-xl bg-indigo-500/10 px-3 py-2.5 text-[11px] text-indigo-700 dark:text-indigo-300">
          Same currency both ends — no exchange rate applies, and{' '}
          {toCountry === 'IN' ? '₹' : '¥'}
          {(parseFloat(amountSent) || 0).toLocaleString()} arrives exactly. For moves like this
          the ↔ Move money sheet is quicker: it asks three questions instead of ten.
        </p>
      )}
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
