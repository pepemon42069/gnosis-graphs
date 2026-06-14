/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The self-hosted server owns /api (commands, queries, SSE) and /docs (the
    // built VitePress site for the in-app viewer); proxy both in dev.
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/docs': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  optimizeDeps: {
    // Lazily imported (§6/§5 LOD) — pre-bundle so their first request never
    // triggers a mid-session dep re-optimization reload in dev.
    include: [
      'react-markdown',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lang-markdown',
      '@codemirror/lang-json',
      '@codemirror/language-data',
      '@codemirror/lint',
      '@codemirror/search',
      '@codemirror/autocomplete',
      'elkjs/lib/elk.bundled.js',
    ],
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
})
