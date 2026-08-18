import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { useCollection } from '../../hooks/useCollection'
import { isAvailable } from '../../lib/ai'
import { compressImage } from '../../lib/imageCompress'
import { extractReceipt } from '../../lib/receiptExtract'
import { vocabulary } from '../../lib/storyIntake'

// Photograph a receipt; it fills the form in.
//
// NOTHING IS SAVED HERE. This produces a draft and hands it back; the normal
// entry flow then shows it, the user picks the card and taps save exactly as
// they would for a typed entry. The receipt path has no writer of its own, so
// there is no second way for a record to reach the database.
//
// Every failure — the feature off, offline, an unreadable photo, a reply the
// validator refuses — ends the same way: the button goes quiet and the keypad
// is right there. A dead end here would be worse than no feature, because the
// user came to log a number they already know.
export default function ReceiptCapture({ onDraft, onBusyChange }) {
  const { settings } = useSettings()
  const trips = useCollection('trips')
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!isAvailable('receipts')) return null

  const setWorking = (value) => {
    setBusy(value)
    onBusyChange?.(value)
  }

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // so the same photo can be retried
    if (!file) return

    setWorking(true)
    setFailed(false)
    try {
      const accounts = settings?.accounts || []
      const vocab = { ...vocabulary({ accounts, trips: trips.data }), accountList: accounts }
      const image = await compressImage(file)
      const draft = await extractReceipt(image, vocab)
      if (!draft.ok) {
        // Refused rather than guessed — an unreadable photo is not a ¥0 expense.
        setFailed(true)
        return
      }
      onDraft(draft)
    } catch {
      // Offline, rate-limited, refused, malformed: all one answer — type it.
      setFailed(true)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-500/40 py-3 text-sm font-semibold text-indigo-500 transition-transform active:scale-[0.99] disabled:opacity-60 touch-manipulation dark:text-indigo-400"
      >
        <Camera size={16} aria-hidden="true" />
        {busy ? 'Reading the receipt…' : 'Snap a receipt'}
      </button>
      {failed && (
        <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
          Could not read that one — type it in as usual.
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  )
}
