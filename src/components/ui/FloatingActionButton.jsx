export default function FloatingActionButton({ onClick, icon = '+', label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label || 'Add'}
      className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-2xl font-medium text-white shadow-lg shadow-indigo-500/30 transition-all duration-150 hover:brightness-110 active:scale-90"
    >
      {icon}
    </button>
  )
}
