import { describe, it, expect, beforeEach } from 'vitest'
import { buildLabel, buildState, isNewVersion, readSeenBuild, writeSeenBuild } from './version'

// Matches the in-memory fake the other storage tests use.
const fakeStorage = () => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

let storage
beforeEach(() => {
  storage = fakeStorage()
})

const build = (version, builtAt, commit = 'abc1234') => ({ version, builtAt, commit })

describe('remembering which build ran here', () => {
  it('round-trips a build', () => {
    const b = build('1.0.0', '2026-08-13T05:00:00.000Z')
    writeSeenBuild(b, storage)
    expect(readSeenBuild(storage)).toEqual(b)
  })

  it('has nothing to report on a device that has never run it', () => {
    expect(readSeenBuild(storage)).toBe(null)
  })

  // A label on the home screen must never be the reason the page dies.
  it('survives unreadable or corrupt storage', () => {
    storage.setItem('vs_seen_build', 'not json')
    expect(readSeenBuild(storage)).toBe(null)
    expect(readSeenBuild({ getItem: () => { throw new Error('blocked') } })).toBe(null)
    expect(() => writeSeenBuild(build('1.0.0', 'x'), {
      setItem: () => { throw new Error('quota') },
    })).not.toThrow()
  })

  it('ignores a stored value of the wrong shape', () => {
    storage.setItem('vs_seen_build', JSON.stringify({ nonsense: true }))
    expect(readSeenBuild(storage)).toBe(null)
  })

  it('works when there is no storage at all', () => {
    expect(readSeenBuild(undefined)).toBe(null)
    expect(() => writeSeenBuild(build('1.0.0', 'x'), undefined)).not.toThrow()
  })
})

describe('comparing this build with the last one', () => {
  const current = build('1.1.0', '2026-08-13T05:00:00.000Z')

  it('reports an update when the version moved', () => {
    const state = buildState(build('1.0.0', '2026-08-01T00:00:00.000Z'), current)
    expect(state.updated).toBe(true)
    expect(state.previous.version).toBe('1.0.0')
    expect(isNewVersion(state)).toBe(true)
  })

  // Two deploys can share a version number. The build time cannot be shared,
  // so it is what actually identifies a build.
  it('reports a rebuild when only the build time moved', () => {
    const state = buildState(build('1.1.0', '2026-08-12T00:00:00.000Z'), current)
    expect(state.updated).toBe(true)
    expect(isNewVersion(state)).toBe(false) // a deploy, not a release
  })

  it('says nothing when it is the same build as last time', () => {
    const state = buildState(current, current)
    expect(state.updated).toBe(false)
    expect(state.previous).toBe(null)
  })

  // A first run has nothing to compare against; claiming an update would be a
  // lie, because you have not updated from anything.
  it('does not claim an update on a first run', () => {
    const state = buildState(null, current)
    expect(state.updated).toBe(false)
    expect(state.first).toBe(true)
    expect(state.previous).toBe(null)
    expect(isNewVersion(state)).toBe(false)
  })
})

describe('buildLabel', () => {
  it('shows the version and when it was built', () => {
    const label = buildLabel(build('1.0.0', '2026-08-13T05:00:00.000Z'), 'en-GB')
    expect(label).toMatch(/^v1\.0\.0 · /)
    expect(label).toMatch(/Aug/)
  })

  it('falls back to the version alone when there is no build time', () => {
    expect(buildLabel({ version: '1.0.0' })).toBe('v1.0.0')
    expect(buildLabel(build('1.0.0', 'not-a-date'))).toBe('v1.0.0')
  })

  it('returns nothing for nothing', () => {
    expect(buildLabel(null)).toBe('')
    expect(buildLabel(undefined)).toBe('')
  })
})
