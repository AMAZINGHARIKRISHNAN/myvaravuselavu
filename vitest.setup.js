import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Every component test starts from an empty document.
afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
})

// The setup file runs for every test, including the plain-node ones, so
// everything touching a DOM is guarded rather than assumed.
const hasDom = typeof window !== 'undefined'

// Things jsdom does not implement that this app uses on every screen.
// Stubbed rather than guarded in the app, because a component should not carry
// branches that exist only for a test environment.
if (hasDom && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

if (hasDom && !window.scrollTo) window.scrollTo = () => {}
if (hasDom && !Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}
if (hasDom && !window.speechSynthesis) {
  window.speechSynthesis = { cancel: () => {}, speak: () => {}, getVoices: () => [] }
}
if (hasDom && !navigator.vibrate) navigator.vibrate = () => true

// The build constants vite injects. Absent under vitest, and version.js reads
// them through a typeof guard, but a component test should see real values.
vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
vi.stubGlobal('__APP_COMMIT__', 'testing')
vi.stubGlobal('__APP_BUILT_AT__', new Date(0).toISOString())
