import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
  onSnapshot,
  getDocs,
  query,
  orderBy,
  where,
  writeBatch,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

const userCollection = (uid, name) => collection(db, 'users', uid, name)
const userDoc = (uid, name, id) => doc(db, 'users', uid, name, id)

// One-shot read (no live subscription) — for on-demand features like the
// image report that shouldn't keep a listener open.
export async function fetchCollectionOnce(uid, name) {
  const snap = await getDocs(userCollection(uid, name))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

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

// Atomic multi-record write: every op lands together or none do — so a
// linked pair (trip + its expense mirror, order + its expense, claim + its
// income) can never be half-saved by a dropped connection.
//   {op:'set', name, data, id?}    — create; id auto-generated unless given
//                                    (a fixed id makes the write idempotent:
//                                    two devices writing it can't duplicate)
//   {op:'update', name, id, data}
//   {op:'delete', name, id}
// `data` may be a function (ids) => ({...}) to reference the generated id of
// any other op in the same commit — that's how both sides link to each other
// before either exists.
export async function commitOps(uid, ops) {
  const batch = writeBatch(db)
  const ids = ops.map((o) => o.id ?? (o.op === 'set' ? doc(userCollection(uid, o.name)).id : null))
  ops.forEach((o, i) => {
    const ref = userDoc(uid, o.name, ids[i])
    const data = typeof o.data === 'function' ? o.data(ids) : o.data
    if (o.op === 'set') {
      batch.set(ref, { ...data, createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
    } else if (o.op === 'update') {
      batch.update(ref, { ...data, updatedAt: Timestamp.now() })
    } else {
      batch.delete(ref)
    }
  })
  await batch.commit()
  return ids
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

// Writes records back under their original doc ids, so restoring the same
// backup twice is idempotent and records created after the backup are kept.
export async function restoreRecords(uid, name, records) {
  const CHUNK = 450
  for (let i = 0; i < records.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const { id, ...data } of records.slice(i, i + CHUNK)) {
      batch.set(userDoc(uid, name, id), data)
    }
    await batch.commit()
  }
  return records.length
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

export async function fetchSettingsOnce(uid) {
  const snap = await getDoc(settingsDoc(uid))
  return snap.exists() ? snap.data() : null
}

export function saveSettings(uid, data) {
  return setDoc(settingsDoc(uid), data, { merge: true })
}
