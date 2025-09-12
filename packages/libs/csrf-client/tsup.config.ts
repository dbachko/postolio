import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  splitting: false,
  target: 'es2023',
  outDir: 'dist',
  shims: true,
  esbuildOptions(options) {
    options.drop = process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [];
  },
});
