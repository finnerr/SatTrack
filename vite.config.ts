import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  plugins: [react(), cesium()],
  test: {
    environment: 'node',
  },
  server: {
    proxy: {
      '/celestrak': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/celestrak/, ''),
        // CelesTrak requires a realistic User-Agent or returns 403
        headers: { 'User-Agent': 'SatTrack/1.0 (satellite tracking application)' },
      },
    },
  },
})
