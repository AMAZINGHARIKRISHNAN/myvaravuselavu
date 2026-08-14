import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { GROUPS, REACHABLE, TABS } from './navigation'

// Every route the router defines, read from App.jsx itself.
//
// Read from the source rather than listed here, because a list of routes
// maintained beside the router is the same mistake this file exists to catch:
// two things that must agree, kept in step by memory.
const routePaths = () => {
  const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8')
  return [...app.matchAll(/<Route path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== '/login') // reached by signing out, not by navigating
}

describe('every page can be reached', () => {
  // The bug: the desktop sidebar kept its own hand-picked list of five, so
  // Trips shipped reachable on a phone and invisible on a desktop — along with
  // eight other routes that had quietly been unreachable there for longer.
  it('has a navigation entry for every route', () => {
    const missing = routePaths().filter((p) => !REACHABLE.includes(p))
    expect(missing).toEqual([])
  })

  it('points at no route that does not exist', () => {
    const routes = routePaths()
    const dangling = REACHABLE.filter((p) => !routes.includes(p))
    expect(dangling).toEqual([])
  })

  it('lists each destination once', () => {
    expect(new Set(REACHABLE).size).toBe(REACHABLE.length)
  })
})

describe('the model itself', () => {
  // A phone tab bar cannot carry more than five and stay tappable.
  it('keeps the tab bar small enough to tap', () => {
    expect(TABS.length).toBeLessThanOrEqual(5)
  })

  it('gives every entry a path, a label and an icon', () => {
    for (const item of [...TABS, ...GROUPS.flatMap((g) => g.items)]) {
      expect(item.to, `${item.label} needs a path`).toMatch(/^\//)
      expect(item.label, `${item.to} needs a label`).toBeTruthy()
      expect(item.Icon, `${item.to} needs an icon`).toBeTruthy()
    }
  })

  it('gives every grouped entry a hint, since the sheet shows one', () => {
    for (const item of GROUPS.flatMap((g) => g.items)) {
      expect(item.hint, `${item.to} needs a hint`).toBeTruthy()
    }
  })

  it('titles every group', () => {
    for (const g of GROUPS) expect(g.title).toBeTruthy()
  })
})
