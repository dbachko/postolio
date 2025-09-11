/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

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
      // Skip HTTPS in CI environment
      if (process.env.CI) {
        return undefined;
      }
      
      try {
        // Look for SSL certificates
        const certPath = '/home/developer/project/certs/ai.localhost+1.pem';
        const keyPath = '/home/developer/project/certs/ai.localhost+1-key.pem';

        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
          return {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
          };
        }
      } catch (error) {
        console.log('No SSL certificates found, running on HTTP');
      }
      return undefined;
    })(),
    proxy: {
      // Proxy API routes to backend - keeps /api prefix as backend expects it
      // Frontend: /api/auth/login → Backend: /api/auth/login
      '/api': {
        target: process.env.CI ? 'http://localhost:3000' : 'https://localhost:3000',
        changeOrigin: true,
        secure: false, // Allow self-signed certificates
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log(
              `🔄 Proxying: ${req.method} ${req.url} → https://localhost:3000${proxyReq.path}`
            );
          });
        },
      },
      // Proxy legal routes to backend for privacy policy and terms
      '/legal': {
        target: process.env.CI ? 'http://localhost:3000' : 'https://localhost:3000',
        changeOrigin: true,
        secure: false, // Allow self-signed certificates
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log(
              `📜 Proxying legal: ${req.method} ${req.url} → https://localhost:3000${proxyReq.path}`
            );
          });
        },
      },
      // Proxy WebSocket connections
      '/ws': {
        target: process.env.CI ? 'ws://localhost:3000' : 'wss://localhost:3000',
        ws: true,
        changeOrigin: true,
        secure: false,
        configure: (proxy: any) => {
          proxy.on('upgrade', (req: any) => {
            console.log(`🔌 WebSocket upgrade: ${req.url}`);
          });
        },
      },
    },
  },
});
