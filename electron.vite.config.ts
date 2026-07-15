import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

export function allowViteDevelopmentStyles(html: string): string {
  return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
}

const developmentRendererCsp = (): Plugin => ({
  name: 'nnote-development-renderer-csp',
  apply: 'serve',
  transformIndexHtml: allowViteDevelopmentStyles,
})

export default defineConfig({
  main: {
    plugins: [],
    build: {
      externalizeDeps: false,
      rollupOptions: { external: ['electron', 'better-sqlite3', '@napi-rs/keyring'] },
    },
  },
  preload: {
    // Sandboxed preloads cannot require arbitrary npm packages. Bundle the
    // contract validators into the preload instead of externalizing them.
    plugins: [],
    build: { externalizeDeps: false, rollupOptions: { external: ['electron'] } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [developmentRendererCsp(), react()],
  },
})
