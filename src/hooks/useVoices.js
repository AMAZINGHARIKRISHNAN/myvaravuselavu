import { useEffect, useState } from 'react'
import { loadVoices } from '../lib/voice'

// The device's voice list, once it arrives.
//
// getVoices() comes back empty on the first call in Chrome and Edge and fills in
// later, so this starts empty and re-renders when the list lands. It also
// re-subscribes to voiceschanged for the lifetime of the screen: on desktop the
// list can grow after load as network voices register.
export function useVoices() {
  const [voices, setVoices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const synth = globalThis.speechSynthesis

    loadVoices(synth).then((list) => {
      if (!alive) return
      setVoices(list)
      setLoading(false)
    })

    if (!synth?.addEventListener) return () => { alive = false }

    const onChange = () => {
      if (alive) setVoices(synth.getVoices() || [])
    }
    synth.addEventListener('voiceschanged', onChange)
    return () => {
      alive = false
      synth.removeEventListener('voiceschanged', onChange)
    }
  }, [])

  return { voices, loading, supported: Boolean(globalThis.speechSynthesis) }
}
