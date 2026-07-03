import { toDate } from './format'

export function downloadCsv(filename, rows, columns) {
  const header = columns.map((c) => c.label).join(',')
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const value = c.value(row)
          const escaped = String(value ?? '').replace(/"/g, '""')
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
  URL.revokeObjectURL(url)
}

export function formatDateForCsv(record) {
  const date = toDate(record.date)
  return date ? date.toISOString().slice(0, 10) : ''
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
