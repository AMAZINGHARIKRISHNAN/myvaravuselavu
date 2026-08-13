// Full-account backup & restore: every collection plus settings in one JSON
// file. The last-resort safety net on the free plan, which has no server
// backups. Restore writes records back under their original ids, so it's
// idempotent and never duplicates.
import { fetchCollectionOnce, fetchSettingsOnce, restoreRecords, saveSettings } from './firestore'

export const BACKUP_APP = 'myvaravuselavu'
export const BACKUP_VERSION = 1
const COLLECTIONS = ['expenses', 'income', 'transfers', 'friendPurchases', 'recurring', 'groups', 'groupExpenses', 'commuteTrips', 'commuteClaims', 'pasmoRecharges', 'cashCounts', 'onlineOrders', 'storePoints', 'officeReimbursements', 'commutePasses', 'windfalls', 'losses', 'withdrawals', 'accountEntries', 'monthAudits', 'reconciles', 'notes']

// Firestore Timestamps don't survive JSON — tag them so restore can turn
// them back into real dates instead of dead {seconds, nanoseconds} husks.
function serializeValue(value) {
  if (value && typeof value.toDate === 'function') {
    return { __type: 'timestamp', value: value.toDate().toISOString() }
  }
  if (value instanceof Date) {
    return { __type: 'timestamp', value: value.toISOString() }
  }
  return value
}

function deserializeValue(value) {
  if (value && typeof value === 'object' && value.__type === 'timestamp') {
    return new Date(value.value)
  }
  return value
}

export function serializeRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, serializeValue(v)]))
}

export function deserializeRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, deserializeValue(v)]))
}

export function parseBackup(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Not a valid backup file')
  }
  if (data?.app !== BACKUP_APP || !data.collections) {
    throw new Error('Not a MyVaravuSelavu backup file')
  }
  return data
}

export async function buildBackup(uid) {
  // All twenty-odd collections at once. They do not depend on each other, and
  // fetching them one after another made an export twenty-odd round trips long
  // — noticeably slow on a phone, for no reason.
  const [settings, ...fetched] = await Promise.all([
    fetchSettingsOnce(uid),
    ...COLLECTIONS.map((name) => fetchCollectionOnce(uid, name)),
  ])
  const collections = Object.fromEntries(
    COLLECTIONS.map((name, i) => [name, fetched[i].map(serializeRecord)])
  )
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    collections,
    settings: settings ? serializeRecord(settings) : null,
  }
}

// Returns total record count restored. Records existing under the same id
// are overwritten with the backup's version; everything else is untouched.
export async function applyBackup(uid, backup) {
  let restored = 0
  for (const name of COLLECTIONS) {
    const records = (backup.collections[name] || []).map(deserializeRecord)
    if (records.length > 0) restored += await restoreRecords(uid, name, records)
  }
  if (backup.settings) await saveSettings(uid, deserializeRecord(backup.settings))
  return restored
}

export function downloadBackup(backup) {
  const stamp = backup.exportedAt.slice(0, 10)
  const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mvs-backup-${stamp}.json`
  // In the DOM before the click and revoked a beat after it, because a
  // detached anchor is ignored by Firefox and revoking in the same tick
  // cancels the download on iOS Safari — which is where this app actually
  // runs. A backup that silently doesn't save is worse than no backup button.
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    a.remove()
  }, 1000)
}
