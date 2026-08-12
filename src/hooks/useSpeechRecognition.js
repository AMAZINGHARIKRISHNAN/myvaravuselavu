import { useEffect, useRef, useState } from 'react'

const SpeechRecognitionAPI =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

export function useSpeechRecognition({ onResult } = {}) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)

  // The recogniser is built once, so reading the callback through a ref is
  // what keeps it current. Closing over `onResult` directly meant only the
  // very first render's callback was ever called — so anything the handler
  // depended on stayed frozen at mount. Updated in an effect rather than
  // during render, which React only guarantees to be safe after commit.
  const onResultRef = useRef(onResult)
  useEffect(() => {
    onResultRef.current = onResult
  })

  useEffect(() => {
    if (!SpeechRecognitionAPI) return
    const recognition = new SpeechRecognitionAPI()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript
      if (transcript) onResultRef.current?.(transcript)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)

    recognitionRef.current = recognition
    return () => recognition.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = () => {
    if (!recognitionRef.current || listening) return
    setListening(true)
    recognitionRef.current.start()
  }

  return { supported: !!SpeechRecognitionAPI, listening, start }
}
