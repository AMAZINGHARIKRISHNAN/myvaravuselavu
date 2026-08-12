import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowLeftRight } from 'lucide-react'
import BottomSheet from '../ui/BottomSheet'
import { useSettings } from '../../hooks/useSettings'
import { useBatchOps } from '../../hooks/useBatchOps'
import { useToast } from '../../context/ToastContext'
import { formatByCountry, toDateInputValue, parseDateInput } from '../../lib/format'
import { celebrate } from '../../lib/celebrate'
import { moneyPlaces, findPlace, checkMove, moveOps, describeMove } from '../../lib/moveMoney'

// Moving your own money from one of your places to another.
//
// The whole sheet is built around saying, in words, which way round it goes
// before anything is written — logging a move backwards is the easiest mistake
// to make here and the most annoying to unpick.

const flag = (place) =>
  place.kind === 'card' ? place.emoji : place.kind === 'cash' ? '💵' : place.country === 'IN' ? '🇮🇳' : '🇯🇵'

const placeName = (place) =>
  // Cash exists twice, once per currency, so it has to say which.
  place.kind === 'cash' ? `Cash ${place.country === 'IN' ? '₹' : '¥'}` : place.label

function PlacePicker({ label, places, value, onChange, exclude }) {
  return (
    <label className="block min-w-0 flex-1 text-xs text-gray-500 space-y-1 dark:text-gray-400">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
        <option value="">— pick —</option>
        {places
          .filter((p) => p.key !== exclude)
          .map((p) => (
            <option key={p.key} value={p.key}>
              {flag(p)} {placeName(p)}
            </option>
          ))}
      </select>
    </label>
  )
}

// `initial` carries what the entry flow already knows. Reaching this sheet
// through the + button means the amount was typed on the keypad one step
// earlier, and asking for it again is the kind of thing that makes an app feel
// like paperwork.
export default function MoveMoneySheet({ initial, onClose, onSaved }) {
  const { settings } = useSettings()
  const batchOps = useBatchOps()
  const { toast } = useToast()

  const places = useMemo(() => moneyPlaces(settings?.accounts || []), [settings?.accounts])
  const [fromKey, setFromKey] = useState('')
  const [toKey, setToKey] = useState('')
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : '')
  const [fee, setFee] = useState('')
  const [dateStr, setDateStr] = useState(initial?.dateStr || toDateInputValue(new Date()))
  // Typed on the keypad already — shown, still correctable, but not asked for
  // a second time.
  const amountCameFromKeypad = Boolean(initial?.amount)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const from = findPlace(places, fromKey)
  const to = findPlace(places, toKey)
  const amountNum = parseFloat(amount) || 0
  const feeNum = parseFloat(fee) || 0

  const check = checkMove(from, to, amountNum)
  const sentence = describeMove({ from, to, amount: amountNum, fee: feeNum }, formatByCountry)
  // A 振込手数料 is a JAPANESE interbank charge, and only that.
  //
  // Asking for it on an ICICI NRE → NRO move was nonsense twice over: Indian
  // banks do not charge for moving your own money between your own accounts,
  // and the field was labelled with a Japanese term for a fee that does not
  // exist there. Cash deposits and card top-ups have no fee either — a
  // top-up's cost IS the top-up. So the field appears for exactly one case.
  const canHaveFee =
    from?.kind === 'account' && to?.kind === 'account' && from.country === 'JP'

  const swap = () => {
    setFromKey(toKey)
    setToKey(fromKey)
  }

  const handleSave = async () => {
    if (!check.ok) {
      setError(check.reason)
      return
    }
    setSaving(true)
    setError('')
    try {
      await batchOps(
        moveOps({
          from,
          to,
          amount: amountNum,
          fee: canHaveFee ? feeNum : 0,
          date: parseDateInput(dateStr),
          note,
        })
      )
      celebrate()
      toast(
        `↔ ${formatByCountry(amountNum, from.country)} moved · ${placeName(from)} → ${placeName(to)}`
      )
      onSaved?.()
      onClose()
    } catch {
      setError('Could not save that move. Try again.')
      setSaving(false)
    }
  }

  if (places.length < 2) {
    return (
      <BottomSheet onClose={onClose} title="Move money">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          You need at least two places to move money between.
        </p>
        <Link to="/settings" onClick={onClose} className="btn-primary block py-3 text-center text-sm">
          Add your accounts in Settings →
        </Link>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet onClose={onClose} title="Move money">
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Your own money changing place — between accounts, in or out of cash, onto a travel card.
        Never counted as spending or income, because you still have it.
      </p>

      <div className="flex items-end gap-1.5">
        <PlacePicker label="From" places={places} value={fromKey} onChange={setFromKey} exclude={toKey} />
        <button
          type="button"
          onClick={swap}
          aria-label="Swap from and to"
          className="mb-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-300/60 text-gray-500 transition-transform active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-800 dark:text-gray-300"
        >
          <ArrowLeftRight size={15} aria-hidden="true" />
        </button>
        <PlacePicker label="To" places={places} value={toKey} onChange={setToKey} exclude={fromKey} />
      </div>

      <div className={`grid gap-3 ${canHaveFee ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Amount{from ? ` (${from.country === 'IN' ? '₹' : '¥'})` : ''}
          {amountCameFromKeypad && (
            <span className="ml-1 text-[10px] text-gray-400">· from the keypad</span>
          )}
          <input
            type="number"
            step="any"
            inputMode="decimal"
            // Only grab focus when there is nothing in it yet; stealing it when
            // the figure is already right just pops the keyboard over the form.
            autoFocus={!amountCameFromKeypad}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input tabular-nums"
          />
        </label>
        {canHaveFee && (
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            振込手数料 · Fee
            <input
              type="number"
              step="any"
              inputMode="decimal"
              placeholder="0"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className="input tabular-nums"
            />
          </label>
        )}
      </div>

      {/* Which way round it goes, in words, before it is written. */}
      {sentence && check.ok && (
        <p className="flex items-start gap-2 rounded-xl bg-indigo-500/10 px-3 py-2.5 text-[11px] text-indigo-700 dark:text-indigo-300">
          <ArrowRight size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{sentence}</span>
        </p>
      )}

      {/* The one refusal that is really a redirect. */}
      {!check.ok && check.remittance && (
        <div className="space-y-2 rounded-xl bg-amber-500/10 px-3 py-2.5">
          <p className="text-[11px] text-amber-700 dark:text-amber-400">{check.reason}</p>
          <Link
            to="/transfers"
            onClick={onClose}
            className="block text-[11px] font-semibold text-amber-800 underline-offset-4 hover:underline dark:text-amber-300"
          >
            Go to Transfers →
          </Link>
        </div>
      )}

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
        disabled={saving || !check.ok}
        onClick={handleSave}
        className="btn-primary min-h-12 w-full text-sm"
      >
        {saving ? 'Saving…' : 'Move it'}
      </button>
    </BottomSheet>
  )
}
