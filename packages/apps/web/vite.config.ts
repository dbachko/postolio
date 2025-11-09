/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

// https://vite.dev/config/

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: (() => {
      const req = createRequire(import.meta.url);
      const base = [
        '@uppy/core',
        '@uppy/react',
        '@uppy/react/dashboard',
        '@uppy/dashboard',
        '@uppy/aws-s3',
      ];
      const optional = ['@uppy/google-drive', '@uppy/dropbox', '@uppy/webcam'];
      const resolvedOptional: string[] = [];
      for (const pkg of optional) {
        try {
          req.resolve(pkg);
          resolvedOptional.push(pkg);
        } catch {
          // ignore if not installed
        }
      }
      return [...base, ...resolvedOptional];
    })(),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: process.env.E2E === '1' ? 'localhost' : 'ai.localhost',
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
    proxy:
      process.env.E2E === '1'
        ? undefined
        : {
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
            // Proxy Assets API routes to the local assets service in dev
            // Use HTTP locally to match the assets API default (no TLS in dev)
            // Frontend: /assets-api/v1/* → Assets Service: /assets-api/v1/*
            '/assets-api': {
              target: 'http://localhost:3002',
              changeOrigin: true,
              secure: false,
              configure: (proxy) => {
                proxy.on('proxyReq', (proxyReq, req) => {
                  console.log(
                    `🖼️  Proxying assets: ${req.method} ${req.url} → http://localhost:3002${proxyReq.path}`
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
