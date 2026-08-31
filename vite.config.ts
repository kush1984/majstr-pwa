import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// App version for the Profile "Версія застосунку" row — read from package.json
// at build time so it never drifts from the published version.
const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      // injectManifest gives us a custom service worker (src/sw.ts) so we can
      // handle 'push' events ourselves. generateSW would auto-create a Workbox
      // SW that only handles caching — not enough for web push.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 'prompt', not 'autoUpdate': in autoUpdate mode the generated registration DISCARDS the
      // `onNeedRefresh` callback (it destructures it and never calls it) and reloads the page
      // itself on `activated`. That silent reload can drop unsaved work on the explicit-save
      // screens (act editor, template editor), which is why `main.tsx` passes a callback and
      // `<UpdateBanner>` exists at all. Both halves are needed — see `src/sw.ts`'s update
      // lifecycle comment for the other one.
      registerType: 'prompt',
      // SW is DISABLED in dev: an active dev service worker precaches the app
      // shell and serves stale JS/CSS, defeating HMR (changes don't show until
      // you manually unregister it). Production builds still ship the SW.
      // To test install / web-push behaviour, run a production build + preview
      // (`vite build && vite preview`) instead of flipping this back on.
      devOptions: {
        enabled: false,
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
    // Vite 6 rejects requests whose Host header it doesn't recognise (DNS-
    // rebinding protection). Tunnel providers hand out random subdomains, so
    // allow their parent domains (a leading dot = any subdomain) for phone
    // testing. Use `allowedHosts: true` if you use a provider not listed here.
    allowedHosts: ['.loca.lt', '.trycloudflare.com', '.ngrok-free.app', '.ngrok.io', '.ngrok.app'],
    // Forward /api to the backend. Only kicks in when the app uses *relative*
    // API URLs (set VITE_API_BASE_URL= empty) — e.g. phone testing through a
    // single HTTPS tunnel, so the browser sees one origin (no mixed-content,
    // no extra CORS origin to whitelist). With the default absolute base URL
    // the app calls the backend directly and this proxy is never used.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
