import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  // Reachable from the phone. HTTPS is not optional here: a plain `http://<LAN-IP>`
  // page is not a secure context, so crypto.subtle (blob hashing) and OPFS are
  // unavailable on the device. Accept the self-signed certificate once on the phone.
  server: {
    host: true,
    // The dev server now speaks HTTPS, so hot reload must use wss:// or the
    // client silently fails to connect.
    hmr: { protocol: 'wss' },
    // The PWA is served over HTTPS, so it cannot call a plain-HTTP API directly
    // (mixed content). Proxying /api keeps the phone working with no extra certs.
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
})
