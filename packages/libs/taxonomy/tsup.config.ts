import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // Build both ESM and CJS to support tsx/require loaders
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node24',
});
