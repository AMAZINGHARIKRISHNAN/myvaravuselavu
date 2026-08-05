import { describe, it, expect } from 'vitest'
import { SKINS, DEFAULT_SKIN, skinMeta, isSkin } from './skins'

describe('skins', () => {
  it('always includes the default', () => {
    expect(isSkin(DEFAULT_SKIN)).toBe(true)
  })

  it('rejects anything not on the list, including junk from localStorage', () => {
    expect(isSkin('mark-99')).toBe(false)
    expect(isSkin(null)).toBe(false)
    expect(isSkin(undefined)).toBe(false)
  })

  // A stored skin that no longer exists must not leave the app unstyled.
  it('falls back to the first skin rather than returning nothing', () => {
    expect(skinMeta('deleted-skin').key).toBe(SKINS[0].key)
    expect(skinMeta(undefined).key).toBe(SKINS[0].key)
  })

  it('gives every skin what the picker and the status bar need', () => {
    for (const s of SKINS) {
      expect(s.key).toMatch(/^[a-z]+$/)
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.tagline.length).toBeGreaterThan(0)
      expect(s.swatch).toHaveLength(3)
      for (const colour of s.swatch) expect(colour).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.themeColor.light).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.themeColor.dark).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('keeps keys unique — they are the CSS selector and the storage value', () => {
    expect(new Set(SKINS.map((s) => s.key)).size).toBe(SKINS.length)
  })
})
