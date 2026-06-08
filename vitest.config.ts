/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vitest — the fast unit/component layer (Playwright `e2e/` is the slow,
 * backend-backed layer). Runs in jsdom, no backend needed. We reuse the `@`
 * alias and the React plugin (for TSX component tests).
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
