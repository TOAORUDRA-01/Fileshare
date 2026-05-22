import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    basicSsl(), // REQUIRED for crypto.subtle (Web Crypto API)
  ],
  server: {
    host: true, // expose on all network interfaces
    allowedHosts: true, // allow localtunnel host
    proxy: {
      '/signal': {
        target: 'ws://localhost:8443',
        ws: true,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/signal/, ''),
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/signal': {
        target: 'ws://localhost:8443',
        ws: true,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/signal/, ''),
      },
    },
  },
})
