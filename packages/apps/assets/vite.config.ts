/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'assetLibrary',
      filename: 'remoteEntry.js',
      // Expose components for Module Federation
      exposes: {
        './AssetLibrary': './src/components/AssetLibrary',
        './AssetPicker': './src/components/AssetPicker',
        './UploadModal': './src/components/UploadModal',
      },
      // Share dependencies with host app
      shared: ['react', 'react-dom', '@tanstack/react-query'],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    modulePreload: false, // Required for Module Federation
    target: 'esnext',
    minify: false, // Better debugging (enable in production)
    cssCodeSplit: false, // Bundle CSS together
  },
  server: {
    port: 3001,
    cors: true, // Allow main app to load components
    host: true, // Listen on all addresses
  },
});
