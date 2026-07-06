import { useAuth } from '../context/AuthContext'
import { addRecord, addRecords, updateRecord, deleteRecord } from '../lib/firestore'

// Write-only access to a collection. Unlike useCollection, this opens no
// snapshot listener — use it in forms and one-shot actions that never read.
export function useCollectionWriters(name) {
  const { user } = useAuth()

  return {
    add: (record) => addRecord(user.uid, name, record),
    addMany: (records) => addRecords(user.uid, name, records),
    update: (id, record) => updateRecord(user.uid, name, id, record),
    remove: (id) => deleteRecord(user.uid, name, id),
  }
}
