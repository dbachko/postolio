import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // Only run colocated tests under src; exclude legacy TAP tests and connector unit aimed at old path
    exclude: [
      'node_modules/',
      'dist/',
      'test/**',
      '**/test/**',
      'src/services/connectors/__tests__/instagram-connector.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/__tests__/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
