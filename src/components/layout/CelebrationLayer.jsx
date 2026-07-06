import { useEffect, useState } from 'react'

const COLORS = ['#6366f1', '#8b5cf6', '#d946ef', '#10b981', '#f59e0b', '#38bdf8']
const PARTICLES_PER_BURST = 22

function makeParticles(burstId) {
  return Array.from({ length: PARTICLES_PER_BURST }, (_, i) => {
    const angle = (Math.PI * (Math.random() * 140 + 20)) / 180 // fan upward
    const distance = 90 + Math.random() * 130
    return {
      id: `${burstId}-${i}`,
      dx: `${Math.cos(angle) * distance * (Math.random() > 0.5 ? 1 : -1)}px`,
      dy: `${-Math.sin(angle) * distance}px`,
      rot: `${(Math.random() - 0.5) * 540}deg`,
      color: COLORS[i % COLORS.length],
      size: 5 + Math.random() * 5,
      round: Math.random() > 0.5,
    }
  })
}

// Listens for vs-celebrate events and throws a short confetti burst from the
// bottom-center of the screen (where save buttons live). Purely decorative.
export default function CelebrationLayer() {
  const [particles, setParticles] = useState([])

  useEffect(() => {
    let burst = 0
    const onCelebrate = () => {
      const id = burst++
      setParticles((prev) => [...prev, ...makeParticles(id)])
      setTimeout(() => {
        setParticles((prev) => prev.filter((p) => !p.id.startsWith(`${id}-`)))
      }, 900)
    }
    window.addEventListener('vs-celebrate', onCelebrate)
    return () => window.removeEventListener('vs-celebrate', onCelebrate)
  }, [])

  if (particles.length === 0) return null

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[80]">
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute left-1/2 bottom-[28%] block animate-[confetti-fly_0.8s_ease-out_forwards]"
          style={{
            '--dx': p.dx,
            '--dy': p.dy,
            '--rot': p.rot,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.round ? '9999px' : '2px',
          }}
        />
      ))}
    </div>
  )
}
