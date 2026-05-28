import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest gives us a custom service worker (src/sw.ts) so we can
      // handle 'push' events ourselves. generateSW would auto-create a Workbox
      // SW that only handles caching — not enough for web push.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // Show the app shell as a PWA in dev too — handy for testing install
      // and offline behaviour without a production build each time.
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // API responses must never be precached — they are user-specific and
        // change on every login / data mutation.
        globIgnores: ['**/api/**'],
      },
      manifest: {
        name: 'Majstr — кошториси для підрядника',
        short_name: 'Majstr',
        description:
          'Інструмент для українських підрядників: клієнти, об\'єкти, кошториси, PDF, портал для клієнта.',
        lang: 'uk',
        dir: 'ltr',
        theme_color: '#ea580c',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true, // bind 0.0.0.0 so we can open it from the phone on LAN
    port: 5173,
  },
});
