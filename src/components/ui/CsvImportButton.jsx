import { useRef, useState } from 'react'
import { parseCsv } from '../../lib/csv'
import { useToast } from '../../context/ToastContext'

export default function CsvImportButton({ label = '⬆ Import CSV', mapRow, onAdd }) {
  const inputRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const { toast } = useToast()

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      let count = 0
      for (const row of rows) {
        const record = mapRow(row)
        if (!record) continue
        await onAdd(record)
        count++
      }
      toast(count > 0 ? `✓ Imported ${count} record${count === 1 ? '' : 's'}` : 'No valid rows found in file')
    } catch {
      toast('Could not import CSV — check the file format')
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
      <button
        type="button"
        disabled={importing}
        onClick={() => inputRef.current?.click()}
        className="btn-ghost w-full py-2 text-xs"
      >
        {importing ? 'Importing…' : label}
      </button>
    </>
  )
}
