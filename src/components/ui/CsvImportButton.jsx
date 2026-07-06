import { useRef, useState } from 'react'
import { parseCsv } from '../../lib/csv'
import { useToast } from '../../context/ToastContext'

export default function CsvImportButton({ label = '⬆ Import CSV', mapRow, onImport }) {
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
      const records = parseCsv(text).map(mapRow).filter(Boolean)
      if (records.length === 0) {
        toast('No valid rows found in file')
        return
      }
      // There is no dedupe — importing the same file twice doubles every record.
      const ok = window.confirm(
        `Import ${records.length} record${records.length === 1 ? '' : 's'} from "${file.name}"?\n\nNote: importing the same file twice will create duplicates.`
      )
      if (!ok) return
      await onImport(records)
      toast(`✓ Imported ${records.length} record${records.length === 1 ? '' : 's'}`)
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
