import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // Build both ESM and CJS to support diverse consumers (tsx/CJS loaders)
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node22',
});
