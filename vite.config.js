import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

// The commit this build came from. Wrapped because a build can legitimately
// happen without git — a fresh clone of the tarball, or CI without history —
// and a missing hash must never be the reason a deploy fails.
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
})()

// https://vite.dev/config/
export default defineConfig({
  // Baked in at build time so the running app can say exactly which build it
  // is. The timestamp matters as much as the version: two deploys can share a
  // version number, but never a build time — so "did my change actually ship?"
  // always has an answer.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // Keep big, rarely-changing vendors in their own chunks so their hashes
    // survive app-code deploys and the PWA precache only re-downloads the
    // small app chunks on update.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/ },
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      includeAssets: ['icon-192.png', 'icon-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}', 'assets/inter-latin-wght-normal-*.woff2'],
      },
    }),
  ],
})
