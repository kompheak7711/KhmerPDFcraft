import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // harfbuzzjs locates its .wasm with `new URL('harfbuzz.wasm', import.meta.url)` and uses
  // top-level await; keep it out of the esbuild pre-bundle so both keep working in dev.
  optimizeDeps: { exclude: ['harfbuzzjs'] },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
