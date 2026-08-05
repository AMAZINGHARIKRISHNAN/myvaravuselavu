import { describe, it, expect } from 'vitest'
import {
  serializeRecord,
  deserializeRecord,
  parseBackup,
  BACKUP_APP,
  BACKUP_VERSION,
} from './backup'

// Stand-in for a Firestore Timestamp: anything with toDate().
const fakeTimestamp = (iso) => ({ toDate: () => new Date(iso) })

describe('serializeRecord / deserializeRecord', () => {
  it('tags Firestore Timestamps and revives them as Dates', () => {
    const record = {
      id: 'abc',
      amount: 1200,
      note: 'lunch',
      date: fakeTimestamp('2026-07-01T10:00:00.000Z'),
    }
    const json = JSON.parse(JSON.stringify(serializeRecord(record)))
    expect(json.date).toEqual({ __type: 'timestamp', value: '2026-07-01T10:00:00.000Z' })

    const revived = deserializeRecord(json)
    expect(revived.date).toBeInstanceOf(Date)
    expect(revived.date.toISOString()).toBe('2026-07-01T10:00:00.000Z')
    expect(revived.amount).toBe(1200)
    expect(revived.note).toBe('lunch')
  })

  it('handles plain Date values too', () => {
    const out = serializeRecord({ date: new Date('2026-01-15T00:00:00.000Z') })
    expect(out.date.__type).toBe('timestamp')
  })

  it('leaves nulls, numbers, strings, and booleans untouched', () => {
    const record = { a: null, b: 0, c: '', d: false, e: 'text' }
    expect(deserializeRecord(serializeRecord(record))).toEqual(record)
  })

  it('round-trips through actual JSON', () => {
    const record = {
      id: 'x1',
      amount: 980.5,
      date: fakeTimestamp('2025-12-31T15:00:00.000Z'),
      createdAt: fakeTimestamp('2025-12-31T15:00:01.000Z'),
      friend: 'Ravi',
    }
    const wire = JSON.stringify({
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      collections: { expenses: [serializeRecord(record)] },
    })
    const back = parseBackup(wire)
    const revived = deserializeRecord(back.collections.expenses[0])
    expect(revived.date.getTime()).toBe(new Date('2025-12-31T15:00:00.000Z').getTime())
    expect(revived.id).toBe('x1')
  })
})

describe('parseBackup', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseBackup('{oops')).toThrow('Not a valid backup file')
  })

  it('rejects JSON from other apps or shapes', () => {
    expect(() => parseBackup('{"foo":1}')).toThrow('Not a MyVaravuSelavu backup file')
    expect(() => parseBackup(JSON.stringify({ app: 'other', collections: {} }))).toThrow(
      'Not a MyVaravuSelavu backup file'
    )
    expect(() => parseBackup(JSON.stringify({ app: BACKUP_APP }))).toThrow(
      'Not a MyVaravuSelavu backup file'
    )
  })

  it('accepts a well-formed backup', () => {
    const data = parseBackup(JSON.stringify({ app: BACKUP_APP, version: 1, collections: {} }))
    expect(data.version).toBe(1)
  })
})
