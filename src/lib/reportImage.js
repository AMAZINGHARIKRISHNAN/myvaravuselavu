// Draws a shareable monthly statement as a PNG on an offscreen canvas —
// no libraries, works fully offline. 1080×1350 (4:5) so it looks right in
// WhatsApp/photo galleries when sent to family.

const W = 1080
const H = 1350
const M = 72 // page margin

const FONT = '"Inter Variable", system-ui, sans-serif'
const yen = (v) => `¥${Math.round(v).toLocaleString('ja-JP')}`

// Rounded-rect path helper (canvas has roundRect but keep it explicit/safe)
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Renders the report and returns a PNG Blob.
 * @param {object} d - { monthLabel, income, expenses, transfers, savingsRate,
 *                       topCategories: [{name, value}], friendsOwe }
 */
export async function renderMonthlyReport(d) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // ---- Background: the app's dark blue-black with a soft indigo glow ----
  ctx.fillStyle = '#0f1420'
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W * 0.85, 90, 0, W * 0.85, 90, 700)
  glow.addColorStop(0, 'rgba(99,102,241,0.35)')
  glow.addColorStop(1, 'rgba(99,102,241,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // ---- Header: brand + month ----
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 44px ${FONT}`
  ctx.fillText('MyVaravuSelavu', M, 128)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = `500 34px ${FONT}`
  ctx.fillText(`Monthly statement · ${d.monthLabel}`, M, 186)

  // ---- Hero: net savings ----
  const net = d.income - d.expenses - d.transfers
  const heroY = 250
  const heroGrad = ctx.createLinearGradient(M, heroY, W - M, heroY + 240)
  heroGrad.addColorStop(0, '#4f46e5')
  heroGrad.addColorStop(1, '#8b5cf6')
  rr(ctx, M, heroY, W - 2 * M, 240, 36)
  ctx.fillStyle = heroGrad
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = `600 30px ${FONT}`
  ctx.fillText('NET SAVINGS', M + 48, heroY + 78)
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 84px ${FONT}`
  ctx.fillText(yen(net), M + 48, heroY + 172)
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = `500 30px ${FONT}`
  ctx.fillText(`${Math.round((d.savingsRate || 0) * 100)}% of income kept`, M + 48, heroY + 216)

  // ---- Three money rows: income / expenses / sent to family ----
  const rows = [
    ['💰  Income', yen(d.income), '#34d399'],
    ['🧾  Expenses', yen(d.expenses), '#f87171'],
    ['💸  Sent to family', yen(d.transfers), '#818cf8'],
  ]
  let y = heroY + 320
  ctx.font = `600 36px ${FONT}`
  for (const [label, value, color] of rows) {
    rr(ctx, M, y, W - 2 * M, 92, 24)
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.textAlign = 'left'
    ctx.fillText(label, M + 40, y + 60)
    ctx.fillStyle = color
    ctx.textAlign = 'right'
    ctx.fillText(value, W - M - 40, y + 60)
    ctx.textAlign = 'left'
    y += 116
  }

  // ---- Top categories with proportional bars ----
  y += 40
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = `600 30px ${FONT}`
  ctx.fillText('TOP SPENDING', M, y)
  y += 36
  const cats = (d.topCategories || []).slice(0, 5)
  const maxCat = Math.max(...cats.map((c) => c.value), 1)
  for (const c of cats) {
    ctx.fillStyle = '#e5e7eb'
    ctx.font = `500 32px ${FONT}`
    ctx.fillText(c.name, M, y + 40)
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.fillText(yen(c.value), W - M, y + 40)
    ctx.textAlign = 'left'
    // Track + fill bar under the label
    rr(ctx, M, y + 58, W - 2 * M, 14, 7)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fill()
    rr(ctx, M, y + 58, Math.max(14, (W - 2 * M) * (c.value / maxCat)), 14, 7)
    ctx.fillStyle = '#6366f1'
    ctx.fill()
    y += 106
  }

  // ---- Friend ledger line (only when someone owes money) ----
  if (d.friendsOwe > 0) {
    y += 24
    rr(ctx, M, y, W - 2 * M, 92, 24)
    ctx.fillStyle = 'rgba(245,158,11,0.12)'
    ctx.fill()
    ctx.fillStyle = '#fbbf24'
    ctx.font = `600 34px ${FONT}`
    ctx.fillText('🤝  Friends still owe you', M + 40, y + 60)
    ctx.textAlign = 'right'
    ctx.fillText(yen(d.friendsOwe), W - M - 40, y + 60)
    ctx.textAlign = 'left'
  }

  // ---- Footer ----
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = `500 26px ${FONT}`
  ctx.fillText('Generated with MyVaravuSelavu', M, H - 64)

  // toBlob hands back null if encoding fails — reject rather than pass a null
  // blob down to the share sheet, where it would "succeed" with an empty file.
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Report render failed'))), 'image/png')
  )
}

// Share the PNG via the native share sheet (falls back to a download when
// file-sharing isn't available, e.g. desktop browsers).
export async function shareReportImage(blob, monthLabel) {
  const file = new File([blob], `myvaravuselavu-${monthLabel.replace(/\s+/g, '-').toLowerCase()}.png`, {
    type: 'image/png',
  })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Monthly report · ${monthLabel}` })
      return
    } catch {
      // user cancelled the share sheet — nothing to do
      return
    }
  }
  // Fallback: plain download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  // Same-task revoke can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
