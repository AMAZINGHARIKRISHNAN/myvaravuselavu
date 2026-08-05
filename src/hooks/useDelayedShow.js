import { useEffect, useState } from 'react'

// "Only show this if the wait is long enough to be worth showing."
//
// Most waits in this app are cache hits — Firebase Auth resolving locally, a
// route chunk already in the service worker. Rendering a loader immediately
// means it appears and disappears inside 50ms, which the eye reads as a flicker
// or a bug rather than as progress.
//
// Returns false until `delay` has passed, so a fast path renders nothing at all
// and only a genuinely slow one gets a loader.
export function useDelayedShow(delay = 400) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return show
}
