import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: (() => {
      try {
        // Look for SSL certificates
        const certPath = '/home/developer/project/certs/ai.localhost+1.pem'
        const keyPath = '/home/developer/project/certs/ai.localhost+1-key.pem'
        
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
          return {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath)
          }
        }
      } catch (error) {
        console.log('No SSL certificates found, running on HTTP')
      }
      return undefined
    })(),
    proxy: {
      // Proxy API routes to backend - removes /api prefix for local development
      // Frontend: /api/auth/login → Backend: /auth/login
      '/api': {
        target: 'https://localhost:3000',
        changeOrigin: true,
        secure: false, // Allow self-signed certificates
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log(`🔄 Proxying: ${req.method} ${req.url} → https://localhost:3000${proxyReq.path}`)
          })
        }
      }
    }
  }
})
