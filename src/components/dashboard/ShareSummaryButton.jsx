import { useState } from 'react'
import { formatJPY, formatPercent } from '../../lib/format'
import { useToast } from '../../context/ToastContext'

function drawSummaryCard({ monthLabel, income, expenses, transfers, savingsRate }) {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 1000
  const ctx = canvas.getContext('2d')

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
  gradient.addColorStop(0, '#4f46e5')
  gradient.addColorStop(0.5, '#7c3aed')
  gradient.addColorStop(1, '#c026d3')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = '600 32px sans-serif'
  ctx.fillText('MyVaravuSelavu', 60, 100)

  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = '500 28px sans-serif'
  ctx.fillText(monthLabel, 60, 150)

  const rows = [
    ['Income', formatJPY(income)],
    ['Expenses', formatJPY(expenses)],
    ['Sent to family', formatJPY(transfers)],
    ['Savings rate', formatPercent(savingsRate)],
  ]

  let y = 280
  for (const [label, value] of rows) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)'
    ctx.font = '500 26px sans-serif'
    ctx.fillText(label, 60, y)
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 56px sans-serif'
    ctx.fillText(value, 60, y + 60)
    y += 160
  }

  return canvas
}

export default function ShareSummaryButton({ monthLabel, income, expenses, transfers, savingsRate }) {
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  const handleShare = async () => {
    setBusy(true)
    try {
      const canvas = drawSummaryCard({ monthLabel, income, expenses, transfers, savingsRate })
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      const file = new File([blob], `myvaravuselavu-${monthLabel}.png`, { type: 'image/png' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${monthLabel} summary` })
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = file.name
        link.click()
        URL.revokeObjectURL(url)
        toast('✓ Summary image downloaded')
      }
    } catch {
      toast('Could not create summary image')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={busy}
      className="text-xs font-medium text-white/80 hover:text-white underline decoration-white/40 underline-offset-2"
    >
      {busy ? 'Preparing…' : '📤 Share this month'}
    </button>
  )
}
