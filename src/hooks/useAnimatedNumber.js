import { useEffect, useRef, useState } from 'react'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Eases a number toward `target` over `duration` ms (cubic ease-out).
// Starts from 0 on mount, so freshly loaded totals count up. Respects
// prefers-reduced-motion by snapping directly to the target.
export function useAnimatedNumber(target, { duration = 600 } = {}) {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    if (reducedMotion()) {
      fromRef.current = target
      setValue(target)
      return
    }
    const from = fromRef.current
    if (from === target) return
    let raf
    const start = performance.now()
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      const next = from + (target - from) * eased
      setValue(next)
      if (p < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      fromRef.current = target
      cancelAnimationFrame(raf)
    }
  }, [target, duration])

  return value
}
