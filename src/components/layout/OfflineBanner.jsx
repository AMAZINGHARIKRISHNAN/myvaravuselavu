import { useEffect, useState } from 'react'

// Firestore queues writes offline, so the app keeps "working" without a network —
// this pill just makes that visible so saves offline don't feel like data loss.
export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null

  return (
    <div role="status" className="sticky top-[57px] z-30 flex justify-center px-4 pt-2 lg:top-3">
      <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-sm dark:bg-amber-500/15 dark:text-amber-400">
        📡 Offline — changes will sync when you're back
      </span>
    </div>
  )
}
