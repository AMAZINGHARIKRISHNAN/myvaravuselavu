// Reading a text-based PDF, in the browser, with no library.
//
// Payroll PDFs are not pictures — the numbers are real text, drawn at known
// coordinates. That means they can be read exactly, on the device, offline and
// for free, instead of being photographed off to a model that might return a
// number nobody printed. For a payslip that distinction matters more than
// anywhere else in this app: a hallucinated ¥ figure would poison every trend
// built on top of it.
//
// Everything here uses APIs the browser already ships:
//   DecompressionStream('deflate')  — inflates the PDF's compressed streams
//   TextDecoder('shift_jis')        — decodes the Japanese, whose CMap is
//                                     90ms-RKSJ-H, i.e. Shift-JIS bytes
//
// What this does NOT do is implement PDF. It extracts positioned text and
// nothing else — no images, no vector art, no font metrics. That is all a
// table of figures needs, and stopping there keeps it a page of code instead
// of a dependency.

// PDF streams are binary. Bytes are carried through JS strings one char per
// byte (never TextEncoder, which would UTF-8 them and corrupt every Shift-JIS
// sequence), so regex can find structure without touching the data.
const bytesToBinaryString = (bytes) => {
  let out = ''
  // Chunked because String.fromCharCode(...bigArray) blows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return out
}

const binaryStringToBytes = (str) => {
  const out = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff
  return out
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// Every FlateDecode stream in the file, inflated. Streams that are not
// compressed (or use a filter we do not implement) are passed through as-is
// rather than failing the whole document.
async function inflateStreams(binary) {
  const parts = []
  const re = /stream\r?\n/g
  let m
  while ((m = re.exec(binary)) !== null) {
    const start = m.index + m[0].length
    const end = binary.indexOf('endstream', start)
    if (end === -1) continue
    const raw = binary.slice(start, end).replace(/\r?\n$/, '')
    try {
      parts.push(await inflate(binaryStringToBytes(raw)))
    } catch {
      parts.push(binaryStringToBytes(raw))
    }
  }
  return parts
}

// PDF string escapes: \( \) \\ \n \r \t \b \f and \ooo octal.
const ESCAPES = { n: 10, r: 13, t: 9, b: 8, f: 12 }
function unescapeBytes(binary) {
  const out = []
  for (let i = 0; i < binary.length; i++) {
    const ch = binary[i]
    if (ch !== '\\') {
      out.push(binary.charCodeAt(i) & 0xff)
      continue
    }
    const next = binary[i + 1]
    if (next === undefined) break
    if (next in ESCAPES) {
      out.push(ESCAPES[next])
      i += 1
    } else if (next >= '0' && next <= '7') {
      const oct = binary.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0]
      out.push(parseInt(oct, 8) & 0xff)
      i += oct.length
    } else {
      out.push(binary.charCodeAt(i + 1) & 0xff)
      i += 1
    }
  }
  return new Uint8Array(out)
}

// One text-showing operator's worth of output, with where it was drawn.
// Only the START position is tracked: advancing x correctly would need the
// font's glyph widths, and column clustering does not care.
function readContentStream(binary, decoder) {
  const items = []
  // Text matrix and line matrix, as [a b c d e f]; only e/f (translation) are
  // used, which is all an upright table needs.
  let tx = 0
  let ty = 0
  let lineX = 0
  let lineY = 0
  let leading = 0

  const TOKEN =
    /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[|\]|[-+]?[\d.]+|T[fdDmLjJ*wcszr]|'|"|BT|ET/g

  const stack = []
  let m
  while ((m = TOKEN.exec(binary)) !== null) {
    const tok = m[0]

    if (tok === 'BT') {
      tx = ty = lineX = lineY = 0
      stack.length = 0
      continue
    }
    if (tok === 'ET') {
      stack.length = 0
      continue
    }

    // Operands accumulate until an operator consumes them.
    if (/^[-+]?[\d.]+$/.test(tok)) {
      stack.push(parseFloat(tok))
      continue
    }
    if (tok[0] === '(' || tok[0] === '<' || tok === '[' || tok === ']') {
      stack.push(tok)
      continue
    }

    switch (tok) {
      case 'TL':
        leading = stack.pop() || 0
        break
      case 'Td':
      case 'TD': {
        const y = stack.pop() || 0
        const x = stack.pop() || 0
        if (tok === 'TD') leading = -y
        lineX += x
        lineY += y
        tx = lineX
        ty = lineY
        break
      }
      case 'Tm': {
        const f = stack.pop() || 0
        const e = stack.pop() || 0
        stack.pop() // d
        stack.pop() // c
        stack.pop() // b
        stack.pop() // a
        lineX = tx = e
        lineY = ty = f
        break
      }
      case 'T*':
        lineY -= leading
        tx = lineX
        ty = lineY
        break
      case 'Tj':
      case "'":
      case '"': {
        if (tok !== 'Tj') {
          lineY -= leading
          tx = lineX
          ty = lineY
        }
        const s = stack.pop()
        if (typeof s === 'string' && s[0] === '(') {
          const text = decoder.decode(unescapeBytes(s.slice(1, -1)))
          if (text) items.push({ x: tx, y: ty, text })
        }
        break
      }
      case 'TJ': {
        // [ (a) -250 (b) ] TJ — the numbers are kerning, ignored here.
        const parts = []
        while (stack.length) {
          const v = stack.pop()
          if (v === '[') break
          if (typeof v === 'string' && v[0] === '(') parts.unshift(v)
        }
        const text = parts
          .map((p) => decoder.decode(unescapeBytes(p.slice(1, -1))))
          .join('')
        if (text) items.push({ x: tx, y: ty, text })
        break
      }
      default:
        // Tf, Tw, Tc, Tz, Ts, Tr — presentation only.
        stack.length = 0
        break
    }
  }
  return items
}

// Positioned text for the whole document, in no particular order.
// `encoding` follows the PDF's CMap: Japanese payroll slips use 90ms-RKSJ-H,
// which is Shift-JIS. Latin-only PDFs decode fine as windows-1252.
export async function extractPdfItems(arrayBuffer, { encoding } = {}) {
  const bytes = new Uint8Array(arrayBuffer)
  const binary = bytesToBinaryString(bytes)
  const enc = encoding || (/90ms-RKSJ|Shift.?JIS|90pv-RKSJ/i.test(binary) ? 'shift_jis' : 'windows-1252')
  const decoder = new TextDecoder(enc, { fatal: false })

  const streams = await inflateStreams(binary)
  const items = []
  for (const stream of streams) {
    const text = bytesToBinaryString(stream)
    // Only page-content streams. Fonts, images and metadata inflate happily
    // too, and running the tokeniser over a font program yields convincing
    // nonsense at plausible coordinates — which is worse than no text at all.
    if (!/\bBT\b/.test(text) || !/\bT[jJ]\b/.test(text)) continue
    items.push(...readContentStream(text, decoder))
  }
  return items
}

// Positioned fragments → visual rows.
//
// This PDF draws most labels one character at a time, each with its own
// position, so the raw items are useless until they are put back together.
// Fragments within `rowTolerance` of each other vertically are one row; within
// a row they are ordered by x and joined, with a gap wider than `colGap`
// treated as a column break rather than a space.
export function groupIntoRows(items, { rowTolerance = 3, colGap = 6 } = {}) {
  const rows = []
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= rowTolerance)
    if (row) row.items.push(item)
    else rows.push({ y: item.y, items: [item] })
  }

  return rows.map((row) => {
    const sorted = row.items.sort((a, b) => a.x - b.x)
    const cells = []
    let current = null
    for (const item of sorted) {
      if (current && item.x - current.endX <= colGap) {
        current.text += item.text
        current.endX = item.x
      } else {
        current = { x: item.x, endX: item.x, text: item.text }
        cells.push(current)
      }
    }
    return {
      y: row.y,
      cells: cells.map((c) => ({ x: c.x, text: c.text.trim() })).filter((c) => c.text),
    }
  })
}
