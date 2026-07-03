import { useEffect, useState } from 'react'
import { fetchLiveJpyInrRate } from '../lib/exchangeRate'

export function useLiveRate() {
  const [rate, setRate] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchLiveJpyInrRate()
      .then((r) => {
        if (!cancelled) setRate(r)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { rate, error }
}
