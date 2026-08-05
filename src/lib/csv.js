import { toDate } from './format'

export function downloadCsv(filename, rows, columns) {
  const header = columns.map((c) => c.label).join(',')
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const value = c.value(row)
          let escaped = String(value ?? '').replace(/"/g, '""')
          // Formula injection guard: a note like "=HYPERLINK(...)" would
          // execute when the CSV opens in Excel/Sheets. A leading apostrophe
          // makes spreadsheet apps treat it as plain text. Only applied to
          // strings so numeric amounts stay numbers.
          if (typeof value === 'string' && /^[=+@\t\r-]/.test(escaped)) {
            escaped = `'${escaped}`
          }
          return /[,"\n]/.test(escaped) ? `"${escaped}"` : escaped
        })
        .join(',')
    )
    .join('\n')

  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoke on the next tick: some browsers abort the download if the object
  // URL disappears in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// LOCAL date, not toISOString (UTC): a 8am JST expense is "today" to the
// user, but in UTC it's still yesterday — exports must not shift the day.
export function formatDateForCsv(record) {
  const date = toDate(record.date)
  if (!date) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Date parser for imports. `new Date('not a date')` yields an Invalid Date,
// which Firestore refuses to write — one typo in one row would otherwise abort
// the whole import (and leave earlier batches half-written). Returning null
// lets the row mapper drop just that row.
export function parseCsvDate(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  // Plain YYYY-MM-DD is parsed as UTC midnight by Date, which lands on the
  // previous day east of Greenwich — read it as a local date instead.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const date = iso
    ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    : new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

// Parses CSV text (handles quoted fields) into an array of row objects keyed by header label.
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      pushField()
    } else if (char === '\n') {
      pushRow()
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field || row.length) pushRow()

  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '')
  if (!header) return []

  return body.map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ''])))
}
