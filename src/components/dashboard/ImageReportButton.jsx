import { useState } from 'react'
import { ImageDown } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { fetchCollectionOnce } from '../../lib/firestore'
import { renderMonthlyReport, shareReportImage } from '../../lib/reportImage'

// "📄 → 🖼" one-tap monthly statement: renders the month as a PNG and opens
// the native share sheet (perfect for sending home on WhatsApp). The friend
// ledger is fetched once on tap — no standing listener just for this button.
export default function ImageReportButton({ monthLabel, income, expenses, transfers, savingsRate, spendByCategory }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const generate = async () => {
    setBusy(true)
    try {
      // Total still owed to me across open friend items (JPY side only —
      // the statement is a JPY document).
      let friendsOwe = 0
      try {
        const purchases = await fetchCollectionOnce(user.uid, 'friendPurchases')
        friendsOwe = purchases
          .filter((p) => (p.country || 'JP') === 'JP' && p.closed !== true)
          .reduce((s, p) => s + Math.max(0, (p.due || 0) - (p.received || 0)), 0)
      } catch {
        // offline / fetch failed — the report just skips the friends line
      }

      const topCategories = Object.entries(spendByCategory || {})
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)

      const blob = await renderMonthlyReport({
        monthLabel,
        income,
        expenses,
        transfers,
        savingsRate,
        topCategories,
        friendsOwe,
      })
      await shareReportImage(blob, monthLabel)
    } catch {
      toast('⚠️ Could not create the report image')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={generate}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/25 active:scale-95 touch-manipulation disabled:opacity-50"
    >
      <ImageDown size={13} aria-hidden="true" />
      {busy ? 'Creating…' : 'Image report'}
    </button>
  )
}
