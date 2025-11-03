/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';
import path from 'path';
import fs from 'fs';

// https://vite.dev/config/
const remoteUrl =
  process.env.VITE_ASSETS_REMOTE_URL ||
  (process.env.NODE_ENV === 'production'
    ? '/assets/remoteEntry.js'
    : 'http://localhost:3001/assets/remoteEntry.js');

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mainApp',
      remotes: {
        assetLibrary: remoteUrl,
      },
      shared: ['react', 'react-dom', '@tanstack/react-query'],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: 'ai.localhost',
    port: 5173,
    https: (() => {
      // Skip HTTPS in CI environment
      if (process.env.CI) {
        return undefined;
      }

      try {
        // Look for SSL certificates
        const certPath =
          process.env.SSL_CERT_PATH || path.resolve(__dirname, '../../../certs/ai.localhost.pem');
        const keyPath =
          process.env.SSL_KEY_PATH ||
          path.resolve(__dirname, '../../../certs/ai.localhost-key.pem');

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
        target: 'https://ai.localhost:3000',
        changeOrigin: true,
        secure: false, // Allow self-signed certificates
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log(
              `🔄 Proxying: ${req.method} ${req.url} → https://ai.localhost:3000${proxyReq.path}`
            );
          });
        },
      },
      // Proxy legal routes to backend for privacy policy and terms
      '/legal': {
        target: 'https://ai.localhost:3000',
        changeOrigin: true,
        secure: false, // Allow self-signed certificates
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log(
              `📜 Proxying legal: ${req.method} ${req.url} → https://ai.localhost:3000${proxyReq.path}`
            );
          });
        },
      },
      // Proxy WebSocket connections
      '/ws': {
        target: 'wss://ai.localhost:3000',
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
