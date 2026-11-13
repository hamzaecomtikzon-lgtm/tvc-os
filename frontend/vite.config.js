import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The API (backend/) runs on its own port; proxying keeps cookies same-origin.
  server: { proxy: { '/api': process.env.API_URL || 'http://localhost:8787' } },
})
