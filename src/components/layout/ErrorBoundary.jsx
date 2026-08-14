import { Component } from 'react'
// A failed chunk download reads as a broken app but is almost always just a
// stale page after a deploy: the file this build asks for was replaced by a
// newer one.
import { reloadForNewBuild, isStaleChunkError } from '../../lib/lazyWithRetry'
import { APP_COMMIT, APP_VERSION, BUILT_AT } from '../../lib/version'

// A crash you can actually report.
//
// This used to show "Something went wrong" and nothing else, logging the real
// error to a console nobody has open on a phone. That makes every crash
// identical from the outside and impossible to diagnose from a screenshot —
// the failure and the only evidence about it arrived at the same moment, and
// only one of them was kept.
//
// The message and the component that threw are on screen now, behind a
// disclosure so the reassuring part still comes first, with one tap to copy the
// lot including which build it happened on.
export default class ErrorBoundary extends Component {
  state = { error: null, stack: '', copied: false }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Reload once for a stale build instead of blaming the user's data; a
    // second failure falls through to the message below.
    if (isStaleChunkError(error) && reloadForNewBuild()) return
    console.error('Unhandled error in app tree:', error, info)
    this.setState({ stack: info?.componentStack || '' })
  }

  report() {
    const { error, stack } = this.state
    return [
      `${error?.name || 'Error'}: ${error?.message || String(error)}`,
      `where: ${this.props.label || 'app'}`,
      `build: v${APP_VERSION}${APP_COMMIT ? ` (${APP_COMMIT})` : ''} ${BUILT_AT}`,
      stack ? `\ncomponents:${stack}` : '',
      error?.stack ? `\nstack:\n${error.stack}` : '',
    ].join('\n')
  }

  copy = async () => {
    try {
      await navigator.clipboard.writeText(this.report())
      this.setState({ copied: true })
    } catch {
      this.setState({ copied: false })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    const stale = isStaleChunkError(this.state.error)

    return (
      <div className="flex min-h-[60svh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 text-2xl text-white shadow-lg">
          ⚠️
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-100">
            {this.props.label ? `${this.props.label} could not load` : 'Something went wrong'}
          </h1>
          <p className="mt-1 text-xs text-gray-400">
            Your data is safe — it's stored in your account, not on this screen.
            {stale
              ? ' The app was just updated; reloading picks up the new version.'
              : ' Reloading usually clears it.'}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-primary px-6 py-2.5 text-sm"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={this.copy}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-gray-300 transition-transform active:scale-95 touch-manipulation"
          >
            {this.state.copied ? 'Copied ✓' : 'Copy details'}
          </button>
        </div>

        {/* The actual error. Closed by default — reassurance first — but one
            tap away, because "something went wrong" is not a bug report. */}
        <details className="w-full max-w-lg text-left">
          <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-gray-300">
            What went wrong
          </summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-[10px] leading-relaxed text-gray-400">
            {this.report()}
          </pre>
        </details>
      </div>
    )
  }
}
