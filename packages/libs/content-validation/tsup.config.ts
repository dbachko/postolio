import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'node24',
  dts: true,
  sourcemap: true,
  clean: true,
});
