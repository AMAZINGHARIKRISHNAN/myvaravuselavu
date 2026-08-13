import { useEffect, useState } from 'react'
import {
  APP_COMMIT,
  APP_VERSION,
  BUILT_AT,
  buildLabel,
  buildState,
  isNewVersion,
  readSeenBuild,
  writeSeenBuild,
} from '../../lib/version'

// Which build this device is running, and what it was before.
//
// An installed PWA serves itself from cache, so a deploy and an update are
// different moments. This is the line that answers "am I actually on the new
// one?" without guessing from whether a fix appears to work.
//
// The previous build is recorded on FIRST PAINT of the new one, so the
// comparison survives being read later — but only after it has been shown, so
// the update notice cannot be missed by the write that clears it.

// Module-level: these are compile-time constants, so the running build is the
// same object for the life of the page and can be depended on safely.
const CURRENT = { version: APP_VERSION, builtAt: BUILT_AT, commit: APP_COMMIT }

export default function BuildStamp() {
  const [state, setState] = useState(() => buildState(readSeenBuild(), CURRENT))
  const { updated, first } = state

  // Recorded AFTER the first paint of a new build, so the comparison survives
  // being read later without the write erasing the notice before it is seen.
  useEffect(() => {
    if (updated || first) writeSeenBuild(CURRENT)
  }, [updated, first])

  const dismiss = () => setState((s) => ({ ...s, updated: false, previous: null }))

  return (
    <div className="space-y-1.5 px-1 pb-2 text-center">
      {updated && (
        <button
          type="button"
          onClick={dismiss}
          className="mx-auto flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-700 transition-transform active:scale-95 touch-manipulation dark:text-emerald-400"
        >
          <span aria-hidden="true">✨</span>
          <span>
            {isNewVersion(state) ? 'Updated' : 'Rebuilt'} — now {buildLabel(state.current)}, was{' '}
            {buildLabel(state.previous)}
          </span>
        </button>
      )}
      <p className="text-[10px] text-gray-400 dark:text-gray-600">
        {buildLabel(state.current)}
        {APP_COMMIT && ` · ${APP_COMMIT}`}
      </p>
    </div>
  )
}
