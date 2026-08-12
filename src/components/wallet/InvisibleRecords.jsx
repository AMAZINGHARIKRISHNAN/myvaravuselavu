import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useBatchOps } from '../../hooks/useBatchOps'
import { findDatelessRecords } from '../../lib/firestore'
import { COLLECTIONS_WITH_DATES, describeDateless, repairDatelessOps } from '../../lib/invisible'

// Records the app cannot see, and the one place they can be recovered from.
//
// Every live query orders by `date`, and Firestore omits documents missing the
// field being ordered on. Such a record is unreachable everywhere else — not
// searchable, not editable, not deletable — and leaves no error behind. The
// write layer no longer creates them, but anything written before that fix is
// still sitting there, invisible and uncounted.
//
// This runs ON DEMAND rather than on load: it is an unordered read of every
// collection, which is exactly the expensive query the rest of the app avoids.
// A button makes the cost a choice.
export default function InvisibleRecords() {
  const { user } = useAuth()
  const { toast } = useToast()
  const batchOps = useBatchOps()
  const [state, setState] = useState({ status: 'idle', found: [] })
  const [busy, setBusy] = useState(false)

  const scan = async () => {
    setState({ status: 'scanning', found: [] })
    try {
      const found = await findDatelessRecords(user.uid, COLLECTIONS_WITH_DATES)
      setState({ status: 'done', found })
      if (found.length === 0) toast('✓ Nothing hidden — every record has a date')
    } catch {
      setState({ status: 'error', found: [] })
    }
  }

  // Giving them a date is what makes them appear; it does not invent anything
  // else. `createdAt` is when the record was actually written, so it is the
  // honest date to restore — falling back to now only when even that is absent.
  const repair = async () => {
    setBusy(true)
    try {
      const ops = repairDatelessOps(state.found)
      for (let i = 0; i < ops.length; i += 400) await batchOps(ops.slice(i, i + 400))
      toast(`✓ ${ops.length} record${ops.length === 1 ? '' : 's'} restored to your history`)
      setState({ status: 'done', found: [] })
    } catch {
      toast('⚠️ Could not restore them — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          🔦 Look for hidden records
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          A record saved without a date is invisible to every screen — it can't be searched, edited
          or deleted. New ones can't happen any more; this finds any left from before.
        </p>
      </div>

      {state.status === 'done' && state.found.length > 0 && (
        <div className="space-y-2 rounded-xl bg-amber-500/10 p-3">
          <p className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {state.found.length} hidden record{state.found.length === 1 ? '' : 's'}:{' '}
              {describeDateless(state.found)}
            </span>
          </p>
          <button
            type="button"
            onClick={repair}
            disabled={busy}
            className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-60 touch-manipulation dark:bg-indigo-500"
          >
            {busy ? 'Restoring…' : 'Restore them to my history'}
          </button>
        </div>
      )}

      {state.status === 'error' && (
        <p className="text-[11px] text-red-600 dark:text-red-400">
          Could not read your collections. Check your connection and try again.
        </p>
      )}

      <button
        type="button"
        onClick={scan}
        disabled={state.status === 'scanning'}
        className="min-h-11 w-full rounded-xl border border-gray-300/60 px-4 text-sm font-semibold text-gray-700 transition-transform active:scale-95 disabled:opacity-60 touch-manipulation dark:border-white/10 dark:text-gray-200"
      >
        {state.status === 'scanning' ? 'Looking…' : 'Scan for hidden records'}
      </button>
    </div>
  )
}
