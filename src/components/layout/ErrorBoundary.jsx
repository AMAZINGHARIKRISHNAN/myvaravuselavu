import { Component } from 'react'
// A failed chunk download reads as a broken app but is almost always just a
// stale page after a deploy: the file this build asks for was replaced by a
// newer one.
import { reloadForNewBuild, isStaleChunkError } from '../../lib/lazyWithRetry'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Reload once for a stale build instead of blaming the user's data; a
    // second failure falls through to the message below.
    if (isStaleChunkError(error) && reloadForNewBuild()) return
    console.error('Unhandled error in app tree:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gray-900 px-6 text-center dark:bg-neutral-950">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 text-2xl text-white shadow-lg">
          ⚠️
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-100">Something went wrong</h1>
          <p className="mt-1 text-xs text-gray-400">
            Your data is safe — it's stored in your account, not on this screen.
            {isStaleChunkError(this.state.error)
              ? ' The app was just updated; reloading picks up the new version.'
              : ' Reloading usually clears it.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary px-6 py-2.5 text-sm"
        >
          Reload
        </button>
      </div>
    )
  }
}
