import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'browser',
  external: ['react', 'react-dom', 'react-dnd', 'react-dnd-html5-backend', 'luxon'],
});
