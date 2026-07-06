import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  writeBatch,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

const userCollection = (uid, name) => collection(db, 'users', uid, name)
const userDoc = (uid, name, id) => doc(db, 'users', uid, name, id)

// ---- Generic collection helpers (income, expenses, transfers) ----

export function subscribeToCollection(uid, name, { onData, onError, dateRange } = {}) {
  const constraints = [orderBy('date', 'desc')]
  if (dateRange?.start) constraints.push(where('date', '>=', Timestamp.fromDate(dateRange.start)))
  if (dateRange?.end) constraints.push(where('date', '<=', Timestamp.fromDate(dateRange.end)))

  const q = query(userCollection(uid, name), ...constraints)
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  )
}

export function addRecord(uid, name, data) {
  return addDoc(userCollection(uid, name), {
    ...data,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

export function updateRecord(uid, name, id, data) {
  return updateDoc(userDoc(uid, name, id), {
    ...data,
    updatedAt: Timestamp.now(),
  })
}

export function deleteRecord(uid, name, id) {
  return deleteDoc(userDoc(uid, name, id))
}

// Batched insert for CSV imports — one commit per chunk instead of one write per row.
// Firestore caps batches at 500 operations.
export async function addRecords(uid, name, records) {
  const CHUNK = 450
  for (let i = 0; i < records.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const data of records.slice(i, i + CHUNK)) {
      batch.set(doc(userCollection(uid, name)), {
        ...data,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    }
    await batch.commit()
  }
  return records.length
}

// Posts a recurring item atomically: the new record and the recurring doc's
// lastGeneratedMonth land in one batch, so a failure can't double-post next visit.
export function addRecordAndMarkRecurring(uid, name, data, recurringId, monthKey) {
  const batch = writeBatch(db)
  batch.set(doc(userCollection(uid, name)), {
    ...data,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
  batch.update(userDoc(uid, 'recurring', recurringId), {
    lastGeneratedMonth: monthKey,
    updatedAt: Timestamp.now(),
  })
  return batch.commit()
}

// ---- Recurring transactions (users/{uid}/recurring) — no `date` field ----

export function subscribeToRecurring(uid, { onData, onError } = {}) {
  const q = query(userCollection(uid, 'recurring'), orderBy('dayOfMonth', 'asc'))
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  )
}

export function addRecurring(uid, data) {
  return addDoc(userCollection(uid, 'recurring'), {
    ...data,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

export function updateRecurring(uid, id, data) {
  return updateDoc(userDoc(uid, 'recurring', id), { ...data, updatedAt: Timestamp.now() })
}

export function deleteRecurring(uid, id) {
  return deleteDoc(userDoc(uid, 'recurring', id))
}

// ---- Settings (single doc: users/{uid}/profile/settings) ----

const DEFAULT_SETTINGS = {
  salaryAmount: 0,
  salaryDate: 25,
  joinDate: null,
  currency: 'JPY',
  accounts: [
    { id: 'jp-debit', label: 'Rakuten Debit', country: 'JP', type: 'debit' },
    { id: 'icici-debit', label: 'ICICI Debit', country: 'IN', type: 'debit' },
  ],
  budgets: {},
  familyGoalLabel: '',
  familyGoalTarget: 0,
  emergencyFundGoal: 0,
}

const settingsDoc = (uid) => doc(db, 'users', uid, 'profile', 'settings')

export function subscribeToSettings(uid, { onData, onError }) {
  return onSnapshot(
    settingsDoc(uid),
    (snap) => onData(snap.exists() ? snap.data() : DEFAULT_SETTINGS),
    onError
  )
}

export async function ensureSettingsExist(uid) {
  const snap = await getDoc(settingsDoc(uid))
  if (!snap.exists()) {
    await setDoc(settingsDoc(uid), DEFAULT_SETTINGS)
  }
}

export function saveSettings(uid, data) {
  return setDoc(settingsDoc(uid), data, { merge: true })
}
