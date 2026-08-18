import { describe, it, expect, beforeEach, vi } from 'vitest'

// The write layer, tested against a fake Firestore.
//
// commitOps is the atomicity primitive the entire data model rests on: a
// commute trip and its expense mirror, a group entry and its personal copy, a
// windfall and its income, both halves of a Move — every one of those pairs is
// only ever correct because this function lands them together or not at all.
// It had no test at all, which meant the guarantee everything else assumes was
// itself unverified.
//
// The fake records what the batch was asked to do rather than pretending to be
// Firestore, so the assertions are about the CONTRACT — ids resolved before any
// data function runs, nothing committed when one op throws — not about the SDK.

let autoIds = 0
let batches = []
let failCommit = false

const makeBatch = () => {
  const calls = []
  return {
    calls,
    committed: false,
    set(ref, data) {
      calls.push({ op: 'set', ref, data })
    },
    update(ref, data) {
      calls.push({ op: 'update', ref, data })
    },
    delete(ref) {
      calls.push({ op: 'delete', ref })
    },
    async commit() {
      if (failCommit) throw new Error('network lost')
      this.committed = true
    },
  }
}

vi.mock('./firebase', () => ({ db: { __fakeDb: true } }))

vi.mock('firebase/firestore', () => ({
  // collection(db, 'users', uid, name)
  collection: (_db, ...path) => ({ __collection: path.join('/') }),
  // Two shapes: doc(collectionRef) mints a new id; doc(db, ...path) addresses one.
  doc: (...args) => {
    if (args.length === 1 && args[0]?.__collection) {
      const id = `auto-${++autoIds}`
      return { id, path: `${args[0].__collection}/${id}` }
    }
    const [, ...path] = args
    return { id: path[path.length - 1], path: path.join('/') }
  },
  writeBatch: () => {
    const b = makeBatch()
    batches.push(b)
    return b
  },
  Timestamp: { now: () => ({ __serverTime: true }) },
  addDoc: vi.fn(async () => ({ id: 'added' })),
  updateDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  setDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn((...a) => ({ __query: a })),
  orderBy: vi.fn((f, d) => ({ __orderBy: [f, d] })),
}))

const { commitOps, addRecord, addRecords } = await import('./firestore')
const { addDoc } = await import('firebase/firestore')

beforeEach(() => {
  autoIds = 0
  batches = []
  failCommit = false
  vi.clearAllMocks()
})

const lastBatch = () => batches[batches.length - 1]

describe('commitOps — id generation', () => {
  it('mints an id for every set that does not bring one', async () => {
    const ids = await commitOps('u1', [
      { op: 'set', name: 'expenses', data: { amount: 1, date: 'd' } },
      { op: 'set', name: 'trips', data: { name: 'Osaka', date: 'd' } },
    ])
    expect(ids).toEqual(['auto-1', 'auto-2'])
  })

  // A fixed id makes a write idempotent — two devices writing the monthly
  // Edenred credit produce one document, not two.
  it('keeps an id it was given rather than minting one', async () => {
    const ids = await commitOps('u1', [
      { op: 'set', name: 'pasmoRecharges', id: 'edenred-2026-08', data: { amount: 10000, date: 'd' } },
    ])
    expect(ids).toEqual(['edenred-2026-08'])
    expect(lastBatch().calls[0].ref.id).toBe('edenred-2026-08')
  })

  it('gives update and delete no generated id', async () => {
    const ids = await commitOps('u1', [
      { op: 'update', name: 'expenses', id: 'e1', data: { amount: 2 } },
      { op: 'delete', name: 'expenses', id: 'e2' },
    ])
    expect(ids).toEqual(['e1', 'e2'])
  })

  it('addresses each op in its own collection', async () => {
    await commitOps('u1', [
      { op: 'set', name: 'trips', data: { name: 'x', date: 'd' } },
      { op: 'update', name: 'expenses', id: 'e1', data: {} },
    ])
    const [a, b] = lastBatch().calls
    expect(a.ref.path).toContain('users/u1/trips')
    expect(b.ref.path).toContain('users/u1/expenses')
  })
})

describe('commitOps — data as a function of ids', () => {
  // The whole point of the primitive: op 1 can point at op 0's id before
  // either document exists. That requires every id to be resolved BEFORE any
  // data function runs.
  it('resolves all ids before the first data function is called', async () => {
    const seen = []
    await commitOps('u1', [
      { op: 'set', name: 'trips', data: { name: 'India', date: 'd' } },
      {
        op: 'set',
        name: 'expenses',
        data: (ids) => {
          seen.push([...ids])
          return { amount: 131080, tripId: ids[0], date: 'd' }
        },
      },
    ])
    // The function saw BOTH ids, including its own, not just the ones before it.
    expect(seen[0]).toEqual(['auto-1', 'auto-2'])
    expect(lastBatch().calls[1].data.tripId).toBe('auto-1')
  })

  it('lets a later op link back and a record know its own id', async () => {
    await commitOps('u1', [
      { op: 'set', name: 'commuteTrips', data: (ids) => ({ expenseId: ids[1], date: 'd' }) },
      { op: 'set', name: 'expenses', data: (ids) => ({ commuteTripId: ids[0], date: 'd' }) },
    ])
    const [trip, expense] = lastBatch().calls
    expect(trip.data.expenseId).toBe('auto-2')
    expect(expense.data.commuteTripId).toBe('auto-1')
  })

  it('accepts a plain object as readily as a function', async () => {
    await commitOps('u1', [{ op: 'set', name: 'notes', data: { text: 'hi', date: 'd' } }])
    expect(lastBatch().calls[0].data.text).toBe('hi')
  })
})

describe('commitOps — the 500-op ceiling', () => {
  const op = (i) => ({ op: 'set', name: 'expenses', data: { amount: i, date: 'd' } })

  it('commits exactly 500', async () => {
    const ids = await commitOps('u1', Array.from({ length: 500 }, (_, i) => op(i)))
    expect(ids).toHaveLength(500)
    expect(lastBatch().committed).toBe(true)
  })

  // Splitting silently would throw away the all-or-nothing guarantee this
  // function exists to provide, so it refuses — and says so in words a caller
  // can put in front of the user.
  it('refuses 501 rather than splitting silently', async () => {
    const ops = Array.from({ length: 501 }, (_, i) => op(i))
    await expect(commitOps('u1', ops)).rejects.toThrow(/Too many changes to save at once \(501/)
  })

  it('writes nothing at all when it refuses', async () => {
    const ops = Array.from({ length: 501 }, (_, i) => op(i))
    await expect(commitOps('u1', ops)).rejects.toThrow()
    expect(batches).toHaveLength(0) // no batch was even opened
  })
})

describe('commitOps — all or nothing', () => {
  // The guarantee. If anything throws while the batch is being assembled, the
  // commit must never happen — a half-saved linked pair describes something
  // that did not occur.
  it('commits nothing when a data function throws', async () => {
    const ops = [
      { op: 'set', name: 'trips', data: { name: 'x', date: 'd' } },
      {
        op: 'set',
        name: 'expenses',
        data: () => {
          throw new Error('bad draft')
        },
      },
    ]
    await expect(commitOps('u1', ops)).rejects.toThrow('bad draft')
    expect(lastBatch().committed).toBe(false)
  })

  // A dropped connection must reach the caller. Reporting success on a commit
  // that never landed is the one failure a ledger cannot absorb: the screen
  // would show a saved record that does not exist.
  it('surfaces a failed commit rather than reporting success', async () => {
    failCommit = true
    const ops = [{ op: 'set', name: 'expenses', data: { amount: 1, date: 'd' } }]
    await expect(commitOps('u1', ops)).rejects.toThrow('network lost')
    expect(lastBatch().committed).toBe(false)
  })

  it('leaves an empty op list as a no-op that still commits cleanly', async () => {
    const ids = await commitOps('u1', [])
    expect(ids).toEqual([])
    expect(lastBatch().calls).toHaveLength(0)
  })
})

describe('commitOps — withDate stamping', () => {
  // A record without `date` is invisible: every live query orders by it, and
  // Firestore omits documents missing the ordered field.
  it('stamps a date on a set that lacks one', async () => {
    await commitOps('u1', [{ op: 'set', name: 'expenses', data: { amount: 900 } }])
    expect(lastBatch().calls[0].data.date).toBeDefined()
  })

  it('never overwrites a date the caller gave', async () => {
    const mine = new Date('2026-09-11T12:00:00Z')
    await commitOps('u1', [{ op: 'set', name: 'expenses', data: { amount: 900, date: mine } }])
    expect(lastBatch().calls[0].data.date).toBe(mine)
  })

  it('stamps createdAt and updatedAt on a set', async () => {
    await commitOps('u1', [{ op: 'set', name: 'expenses', data: { amount: 1, date: 'd' } }])
    const { data } = lastBatch().calls[0]
    expect(data.createdAt).toBeDefined()
    expect(data.updatedAt).toBeDefined()
  })

  // An update must not invent a date for a document that already has one, and
  // must not resurrect one the user deliberately cleared.
  it('does not add a date to an update', async () => {
    await commitOps('u1', [{ op: 'update', name: 'expenses', id: 'e1', data: { amount: 2 } }])
    const { data } = lastBatch().calls[0]
    expect(data.date).toBeUndefined()
    expect(data.updatedAt).toBeDefined()
  })

  it('carries a null through an update, so a tag can be cleared', async () => {
    await commitOps('u1', [{ op: 'update', name: 'expenses', id: 'e1', data: { tripId: null } }])
    expect(lastBatch().calls[0].data.tripId).toBe(null)
  })
})

describe('addRecord', () => {
  it('stamps a date when the caller omitted one', async () => {
    await addRecord('u1', 'expenses', { amount: 900 })
    expect(addDoc.mock.calls[0][1].date).toBeDefined()
  })

  it('keeps the caller’s date', async () => {
    const mine = new Date('2026-01-02T12:00:00Z')
    await addRecord('u1', 'expenses', { amount: 900, date: mine })
    expect(addDoc.mock.calls[0][1].date).toBe(mine)
  })
})

describe('addRecords — chunked import', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ amount: i, date: 'd' }))

  it('uses one batch for a small import', async () => {
    await addRecords('u1', 'expenses', rows(10))
    expect(batches).toHaveLength(1)
    expect(batches[0].calls).toHaveLength(10)
  })

  // 450 per chunk, so each commit stays whole and well under the 500 ceiling.
  it('splits a large import into whole chunks', async () => {
    await addRecords('u1', 'expenses', rows(1000))
    expect(batches).toHaveLength(3)
    expect(batches.map((b) => b.calls.length)).toEqual([450, 450, 100])
    expect(batches.every((b) => b.committed)).toBe(true)
  })

  it('stamps a date on every imported row that lacks one', async () => {
    await addRecords('u1', 'expenses', [{ amount: 1 }, { amount: 2 }])
    expect(batches[0].calls.every((c) => c.data.date !== undefined)).toBe(true)
  })

  it('does nothing for an empty import', async () => {
    await addRecords('u1', 'expenses', [])
    expect(batches).toHaveLength(0)
  })
})
