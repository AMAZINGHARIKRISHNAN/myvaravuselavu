// Skins: a second axis alongside light/dark.
//
// Light/dark decides how bright the app is. A skin decides what the app is MADE
// of — colour, corner radius, density, how fast it moves, what it sounds like,
// and how its charts are drawn. They compose, so each skin works in daylight
// and at night without a second set of screens.
//
// Five suits, all meant to be lived in:
//   classic — the quiet indigo ledger this app started as
//   neon    — the dashboard look: deep canvas, gradient rings, glowing tiles
//   jarvis  — arc-reactor cyan HUD          ┐
//   friday  — crimson combat HUD            ├ one HUD chassis, three identities
//   edith   — midnight-navy tactical HUD    ┘
//
// The last three share EVERYTHING structural — glass panels, reticle corner
// brackets, the arc-reactor ring, the scanline grid — and differ only in their
// accent tokens. That's why they carry `hud: {...}`: the shared chrome lives in
// one `[data-hud]` CSS block, and an identity is a handful of colours, not a
// third copy of the design. Adding a fourth suit is a registry entry.
//
// It rides on Tailwind v4 variables, so a whole skin is a block of custom
// properties rather than a fork of every component:
//
//   --color-indigo-*  every accent in this app is an `indigo` utility, and v4
//                     compiles those to var(--color-indigo-600) and friends
//   --spacing         every p-*, gap-*, m-* utility is a multiple of it, so
//                     nudging it retunes the density of the entire app
//
// Radius and motion ride along as --radius-* and --skin-dur. `sound` is read by
// lib/sound.js, which synthesises the UI ticks rather than shipping audio.
// `chart` is read by lib/chartTheme.js for series colours and gradients.
export const SKINS = [
  {
    key: 'classic',
    label: 'Classic',
    tagline: 'The quiet indigo ledger',
    emoji: '🔷',
    swatch: ['#4f46e5', '#6366f1', '#a5b4fc'],
    themeColor: { light: '#111827', dark: '#080b12' },
    traits: { shape: 'Soft 16px', density: 'Normal', motion: 'Calm', sound: 'Soft' },
    sound: { wave: 'sine', tap: 660, confirm: [660, 990], error: [220, 165], gain: 0.05 },
    chart: {
      // Flat, legible, no theatre — the palette this app has always used.
      series: { income: '#059669', expenses: '#f43f5e', transfers: '#6366f1', profit: '#059669' },
      categories: ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f43f5e', '#84cc16'],
      gradients: false,
      ringWidth: 26,
      glow: false,
    },
  },
  {
    key: 'neon',
    label: 'Neon Deck',
    tagline: 'Deep canvas, gradient rings, glowing tiles',
    emoji: '🟣',
    swatch: ['#7c3aed', '#d946ef', '#fb923c'],
    themeColor: { light: '#0b0d17', dark: '#07080f' },
    traits: { shape: 'Round 22px', density: 'Roomy', motion: 'Fluid', sound: 'Digital' },
    sound: { wave: 'triangle', tap: 740, confirm: [740, 1180], error: [260, 180], gain: 0.045 },
    chart: {
      // Violet → fuchsia → orange, the arc every reference dashboard runs on.
      series: { income: '#22d3ee', expenses: '#fb7185', transfers: '#a78bfa', profit: '#34d399' },
      categories: ['#7c3aed', '#a855f7', '#d946ef', '#ec4899', '#fb923c', '#f59e0b', '#22d3ee', '#34d399'],
      gradients: true,
      ringWidth: 34, // thick ring, the way the references draw them
      glow: true,
    },
  },

  // ---- The HUD family ------------------------------------------------------
  // `hud` is the identity: four colours the shared chassis is tinted with.
  //   core  — the primary accent; borders, brackets, the arc reactor's arc
  //   core2 — a brighter twin, for the hot inner edge of a glow
  //   alt   — the secondary/warning accent, used where a second hue is needed
  //   bg    — the canvas the panels float on (dark mode; light mode frosts)
  // JS reads these for the SVG ring and the canvas grid, CSS reads the same
  // values as custom properties. One source, two consumers.
  {
    key: 'jarvis',
    label: 'J.A.R.V.I.S.',
    tagline: 'Arc-reactor cyan. All systems nominal.',
    emoji: '🔵',
    swatch: ['#3fd0ff', '#57e2ff', '#ffb547'],
    themeColor: { light: '#05101a', dark: '#03060c' },
    traits: { shape: 'HUD 14px', density: 'Normal', motion: 'Precise', sound: 'Clean' },
    hud: { core: '#3fd0ff', core2: '#57e2ff', alt: '#ffb547', bg: '#03060c' },
    sound: { wave: 'square', tap: 880, confirm: [880, 1320], error: [240, 180], gain: 0.034 },
    chart: {
      // Income stays green and expenses stay red even inside a cyan HUD:
      // the identity may change, but "up is good" is not negotiable.
      series: { income: '#34e0b0', expenses: '#ff6b81', transfers: '#3fd0ff', profit: '#ffb547' },
      categories: ['#3fd0ff', '#57e2ff', '#0090d0', '#7ce8ff', '#ffb547', '#ffd27a', '#34e0b0', '#9d8cff'],
      gradients: true,
      ringWidth: 30,
      glow: true,
    },
  },
  {
    key: 'friday',
    label: 'F.R.I.D.A.Y.',
    tagline: 'Crimson and amber. Combat-ready.',
    emoji: '🔴',
    swatch: ['#ff3b3b', '#ff5e5e', '#ff8a3d'],
    themeColor: { light: '#160a09', dark: '#0c0605' },
    traits: { shape: 'HUD 14px', density: 'Normal', motion: 'Urgent', sound: 'Gritty' },
    hud: { core: '#ff3b3b', core2: '#ff5e5e', alt: '#ff8a3d', bg: '#0c0605' },
    sound: { wave: 'sawtooth', tap: 620, confirm: [620, 930], error: [200, 150], gain: 0.036 },
    chart: {
      series: { income: '#5ddba4', expenses: '#ff3b3b', transfers: '#ff8a3d', profit: '#ffc46b' },
      categories: ['#ff3b3b', '#ff5e5e', '#ff8a3d', '#ffab5e', '#ff2d78', '#ffd166', '#c94b4b', '#ff7ac0'],
      gradients: true,
      ringWidth: 30,
      glow: true,
    },
  },
  {
    key: 'edith',
    label: 'E.D.I.T.H.',
    tagline: 'Midnight navy and gold. Eyes everywhere.',
    emoji: '🟡',
    swatch: ['#2f8bff', '#1b6bff', '#ffc24d'],
    themeColor: { light: '#0a1122', dark: '#050914' },
    traits: { shape: 'HUD 14px', density: 'Normal', motion: 'Smooth', sound: 'Warm' },
    hud: { core: '#2f8bff', core2: '#5aa6ff', alt: '#ffc24d', bg: '#050914' },
    sound: { wave: 'triangle', tap: 780, confirm: [780, 1170], error: [230, 170], gain: 0.044 },
    chart: {
      series: { income: '#4fd6a0', expenses: '#ff6b6b', transfers: '#2f8bff', profit: '#ffc24d' },
      categories: ['#2f8bff', '#1b6bff', '#5aa6ff', '#8cc2ff', '#ffc24d', '#ffd782', '#7c7cff', '#4fd6a0'],
      gradients: true,
      ringWidth: 30,
      glow: true,
    },
  },
]

export const DEFAULT_SKIN = 'classic'

export const skinMeta = (key) => SKINS.find((s) => s.key === key) || SKINS[0]

export const isSkin = (key) => SKINS.some((s) => s.key === key)

// Is this suit a HUD? Everything HUD-only keys off this: the `data-hud`
// attribute, the boot sequence, the arc reactor, the scanline layer. A skin
// without a `hud` block is a flat skin and takes none of that code.
export const isHud = (key) => Boolean(skinMeta(key).hud) && isSkin(key)

// The two halves of the picker, so Settings never hand-maintains a list that
// can fall out of step with the registry.
export const HUD_SKINS = SKINS.filter((s) => s.hud)
export const FLAT_SKINS = SKINS.filter((s) => !s.hud)

// The identity's colours, or the default suit's absence of them. Callers that
// draw (arc reactor, grid canvas) use this rather than reaching into SKINS.
export const hudMeta = (key) => skinMeta(key).hud || null
