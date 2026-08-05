// Renaming an account has to carry its history with it.
//
// Every balance in the app is derived by matching a record's source field
// against the account's label — `paymentMethod === 'MUFJ'`, `account === 'MUFJ'`
// and so on. Change the label and every past record keeps pointing at the old
// name: it still exists, still shows in History, but can never move a balance
// again, and nothing tells you. So a rename re-tags them all.
//
// Each entry is a collection and the fields in it that can name a source.
export const SOURCE_FIELDS = [
  { name: 'expenses', fields: ['paymentMethod'] },
  { name: 'income', fields: ['account'] },
  { name: 'transfers', fields: ['fromAccount', 'toAccount'] },
  { name: 'pasmoRecharges', fields: ['paidFrom'] },
  { name: 'officeReimbursements', fields: ['paidWith'] },
  { name: 'commutePasses', fields: ['paidFrom'] },
  { name: 'withdrawals', fields: ['account'] },
  { name: 'accountEntries', fields: ['account'] },
  { name: 'groupExpenses', fields: ['paymentMethod'] },
  { name: 'recurring', fields: ['paymentMethod'] },
]

// Which records in one collection mention the old name, and the patch each one
// needs. Only the fields that actually match are touched, so a transfer that
// merely received money keeps its other side intact.
export function retagOps(collectionName, records = [], from, to) {
  const entry = SOURCE_FIELDS.find((c) => c.name === collectionName)
  if (!entry || !from || !to || from === to) return []
  const ops = []
  for (const record of records) {
    const data = {}
    for (const field of entry.fields) {
      if (record[field] === from) data[field] = to
    }
    if (Object.keys(data).length > 0) {
      ops.push({ op: 'update', name: collectionName, id: record.id, data })
    }
  }
  return ops
}

// Every rename in one settings save, as a flat list of writes. `loaded` maps a
// collection name to its records.
export function retagAllOps(renames = [], loaded = {}) {
  const ops = []
  for (const { from, to } of renames) {
    for (const { name } of SOURCE_FIELDS) {
      ops.push(...retagOps(name, loaded[name] || [], from, to))
    }
  }
  return ops
}

// Labels that changed between the saved accounts and the ones being saved,
// matched by id so a rename is told apart from a delete-plus-add.
export function detectRenames(previous = [], next = []) {
  const before = new Map(previous.map((a) => [a.id, a.label]))
  return next
    .filter((a) => before.has(a.id) && before.get(a.id) !== a.label)
    .map((a) => ({ from: before.get(a.id), to: a.label }))
    .filter((r) => r.from?.trim() && r.to?.trim())
}
