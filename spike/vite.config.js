import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Isolated spike — no proxy, no backend, nothing shared with the real app.
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, open: false },
})
