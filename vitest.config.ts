import { defineConfig, type UserConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vitest — the fast unit/component layer (Playwright `e2e/` is the slow,
 * backend-backed layer). Runs in jsdom, no backend needed. We reuse the `@`
 * alias and the React plugin (for TSX component tests).
 */
/*
 * vitest 2.x bundles its OWN vite 5, while the app builds on vite 6 — so
 * `@vitejs/plugin-react` is typed against vite 6's `Plugin` while this field expects
 * vite 5's. The two are structurally identical and the suite runs fine (esbuild strips
 * the types); the clash is purely nominal, caused by two copies of vite in the tree.
 *
 * Removing this cast means upgrading vitest to 3.x, which is aligned with vite 6 — a
 * deliberate dependency call with 400+ tests behind it, not a drive-by fix. Kept narrow
 * and named so it cannot quietly hide an unrelated plugin type error.
 */
const plugins = [react()] as unknown as UserConfig['plugins'];

export default defineConfig({
  plugins,
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
