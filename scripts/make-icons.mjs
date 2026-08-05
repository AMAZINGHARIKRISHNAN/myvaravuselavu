// Regenerates public/icon-192.png and icon-512.png from public/logo.svg.
// Run after editing the logo: node scripts/make-icons.mjs
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const svg = readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8')
// Full-bleed square for maskable PWA icons — the launcher applies its own mask.
const fullBleed = svg.replaceAll('rx="115"', 'rx="0"')

for (const size of [192, 512]) {
  await sharp(Buffer.from(fullBleed), { density: 300 })
    .resize(size, size)
    .png()
    .toFile(new URL(`../public/icon-${size}.png`, import.meta.url).pathname.slice(1))
}
console.log('icons written')
