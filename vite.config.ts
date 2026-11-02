import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
