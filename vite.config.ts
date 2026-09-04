import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // На Windows vite по умолчанию слушал только IPv6 (::1), и браузер, который резолвит
  // localhost в 127.0.0.1, получал «connection refused». Прибиваем к IPv4-петле.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
