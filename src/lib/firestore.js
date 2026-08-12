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

// One live query per collection, newest first. Date windows are applied by the
// caller against this result (see withinRange) rather than by the server: the
// app already loads every collection in full somewhere, so a narrower query was
// never a smaller download — only an extra one.
export function subscribeToCollection(uid, name, { onData, onError } = {}) {
  const q = query(userCollection(uid, name), orderBy('date', 'desc'))
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  )
}


// Every record gets a date, always.
//
// The live query orders by `date`, and Firestore NEVER returns a document that
// is missing the field being ordered on. A record written without one is not
// merely misplaced — it is invisible to every screen, cannot be searched,
// edited, or even deleted through the app, and leaves no error behind. It is
// simply gone while still costing storage.
//
// So the write layer refuses to create one. `date` is the only field defaulted
// here rather than left to the caller, because it is the only field whose
// absence makes a record unreachable. Now stamped when missing, which is the
// truthful answer for a record being written now.
const withDate = (data) => (data?.date ? data : { ...data, date: Timestamp.now() })

export function addRecord(uid, name, data) {
  return addDoc(userCollection(uid, name), {
    ...withDate(data),
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
//
// Firestore commits at most 500 operations at once. Splitting silently would
// throw away the all-or-nothing guarantee this function exists to provide, so
// it refuses instead — loudly, and in words a caller can put in front of the
// user. Callers whose work genuinely divides (a month of commute days, a CSV
// import) chunk it themselves into commits that each stay whole.
const BATCH_LIMIT = 500

export async function commitOps(uid, ops) {
  if (ops.length > BATCH_LIMIT) {
    throw new Error(
      `Too many changes to save at once (${ops.length} of a maximum ${BATCH_LIMIT}). Do it in smaller pieces.`
    )
  }
  const batch = writeBatch(db)
  const ids = ops.map((o) => o.id ?? (o.op === 'set' ? doc(userCollection(uid, o.name)).id : null))
  ops.forEach((o, i) => {
    const ref = userDoc(uid, o.name, ids[i])
    const data = typeof o.data === 'function' ? o.data(ids) : o.data
    if (o.op === 'set') {
      batch.set(ref, { ...withDate(data), createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
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
        ...withDate(data),
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

// Records already written without a date, which the live query cannot see.
//
// This is the ONLY way to find them: an unordered read. The ordered
// subscription every screen uses skips them by definition, so they cannot be
// listed, searched or deleted anywhere in the app — a check that never looked
// would never find anything, and the storage would grow quietly forever.
export async function findDatelessRecords(uid, names = []) {
  const found = []
  for (const name of names) {
    const rows = await fetchCollectionOnce(uid, name)
    for (const r of rows) if (!r.date) found.push({ ...r, collection: name })
  }
  return found
}
