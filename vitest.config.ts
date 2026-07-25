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
  define: {
    // Mirror vite.config's build-time constant so component tests can render
    // surfaces that show the app version.
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
