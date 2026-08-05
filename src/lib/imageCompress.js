// Shrinks a photo down to a small JPEG data URL so it can live INSIDE a
// Firestore document (free plan has no Storage bucket; docs cap at 1MB).
// Receipt photos survive this fine — text stays readable at 1000px.

const load = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read image'))
    }
    img.src = url
  })

// Returns a data URL guaranteed under maxBytes, stepping down size/quality
// until it fits. Throws if even the smallest attempt is too big (never in
// practice — a 500px q0.4 JPEG is a few tens of KB).
export async function compressImage(file, { maxBytes = 650_000 } = {}) {
  const img = await load(file)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const attempts = [
    { dim: 1200, q: 0.7 },
    { dim: 1000, q: 0.6 },
    { dim: 800, q: 0.5 },
    { dim: 500, q: 0.4 },
  ]
  for (const { dim, q } of attempts) {
    const scale = Math.min(1, dim / Math.max(img.width, img.height))
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', q)
    // Data URL is base64: ~4/3 of the byte size, close enough for a cap check.
    if (dataUrl.length * 0.75 <= maxBytes) return dataUrl
  }
  throw new Error('Photo is too detailed to compress — try a closer, simpler shot')
}
