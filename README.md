# Majstr PWA

Mobile-first React + TypeScript PWA. Client of the Spring Boot backend
in the sibling repo `C:\Work\majstr-backend\`. Ships the full contractor
UI — auth, dashboard, projects, the inline new-estimate flow, the estimate
editor, catalog and profile — plus PWA manifest, service worker and the
web-push scaffolding.

## Stack

- React 19 + TypeScript (strict)
- Vite 6 + `vite-plugin-pwa` (`injectManifest` strategy with a custom SW)
- React Router 7
- TanStack Query 5 for server state
- Axios HTTP client with a refresh-token interceptor
- Tailwind CSS 3 for styling
- react-hook-form + Zod for forms

## Quick start

```bash
# 1. install deps
npm install

# 2. point at your backend
cp .env.example .env
# edit .env if backend is not on http://localhost:8080

# 3. run the dev server
npm run dev
# opens http://localhost:5173 — Vite binds 0.0.0.0 so you can also hit it
# from your phone on the same Wi-Fi (see "Test on a phone" below).
```

Build for production:

```bash
npm run build           # outputs dist/
npm run preview         # serves dist/ for a quick sanity check
```

## End-to-end tests

A Playwright smoke test walks the core contractor journey — register →
dashboard → new estimate (inline client + object) → add a catalog item →
totals recompute in ₴ → share feedback. Run it now and then to catch
regressions across the whole stack.

```bash
npm run test:e2e        # headless run (the report opens with test:e2e:report)
npm run test:e2e:ui     # interactive Playwright UI for debugging
```

**Needs the backend running on `http://localhost:8080`** (Playwright can't
start the Java app; it checks reachability and fails fast with a hint if it's
down). The Vite dev server is started automatically, or reused if one is
already on 5173. Each run registers a fresh user, so it's repeatable without
cleanup — it does leave test rows in the dev DB.

## Backend CORS reminder

The backend already configures CORS from `app.cors.allowed-origins` (or
the `CORS_ALLOWED_ORIGINS` env var). The dev defaults include
`http://localhost:5173`, so this PWA works out of the box.

If you run the dev server on a different port, or you open it from your
phone via `http://192.168.x.y:5173`, **add that origin** to the backend's
`CORS_ALLOWED_ORIGINS` (comma-separated). Without it the browser blocks
the API call before it even leaves.

## Icons

`vite-plugin-pwa` needs three PNG icons referenced by the manifest:

```
public/icons/icon-192.png
public/icons/icon-512.png
public/icons/icon-maskable-512.png
public/icons/apple-touch-icon.png
```

A placeholder `public/logo.svg` is included (orange tile with a white
"M"). To generate the PNGs from it in one command:

```bash
npx pwa-asset-generator public/logo.svg public/icons \
  --icon-only --type png --opaque false --padding "0"

npx pwa-asset-generator public/logo.svg public/icons \
  --icon-only --type png --opaque true --maskable true \
  --background "#ea580c" --padding "10%"
```

You only need to do this once (or after you swap the logo). If you skip
it, the app still runs but the manifest will log icon-not-found warnings
and the "Add to Home Screen" prompt shows a generic icon.

## Test on a phone

PWA install prompts and `Notification.requestPermission()` both refuse
to run on plain HTTP, except for `localhost`. To test the real install
on your phone:

1. Make sure the phone is on the same Wi-Fi as your laptop.
2. Find your laptop's local IP:
   - Windows: `ipconfig` → look for IPv4
   - macOS / Linux: `ifconfig` or `ip addr`
3. Open `http://<your-ip>:5173` on the phone.
4. Add the local IP to the backend's `CORS_ALLOWED_ORIGINS` (see above).
5. **Android (Chrome):** menu → *Install app* / *Add to Home Screen*.
6. **iOS (Safari only):** share button → *Add to Home Screen*.

For full PWA features (service worker beyond `localhost`, web push), you
need HTTPS. Two easy options:

- `ngrok http 5173` — gives you a public HTTPS URL.
- `mkcert` + Vite's HTTPS option — local certificate.

## Web push

`EnablePushButton` on the dashboard kicks off:

1. `Notification.requestPermission()`
2. `serviceWorkerRegistration.pushManager.subscribe()` with the VAPID
   public key from `VITE_VAPID_PUBLIC_KEY`
3. `POST /api/push/subscribe` to hand the subscription to the backend

Step 3 currently fails with 404 — the backend endpoint is a TODO. The
client code is wired up so when the backend lands, only the request
shape might need a tweak.

**iOS caveat:** Apple ships web push only for PWAs installed via *Add
to Home Screen* on iOS 16.4+. The button will be a no-op in regular
Safari.

## Project layout

```
src/
├── api/        HTTP client, endpoint wrappers (auth, clients, projects, estimates, catalog, dashboard), backend response types
├── components/ reusable UI primitives (Button, Input, Badge, Chip, MetricCard, ProjectCard, Modal, EmptyState, Skeleton, …)
├── features/   feature folders, one per surface (app shell, auth, dashboard, projects, estimate, catalog, clients, profile)
├── hooks/      cross-cutting hooks (useToast, usePush)
├── lib/        token storage, config, design-token-aware helpers (format money/dates, labels, decimal parsing)
├── routes/     ProtectedRoute, route table
├── styles/     Tailwind directives, base globals
├── sw.ts       custom service worker (precache + push handler)
├── App.tsx, main.tsx
```

`src/main.tsx` is the entry point. It wires `QueryClient`, the router,
and the SW registration.

## Where to look first

- `src/api/client.ts` — axios instance, refresh-token interceptor
- `src/lib/tokens.ts` — token storage and why `localStorage`
- `src/routes/ProtectedRoute.tsx` — auth gate driven by `useMe`
- `src/sw.ts` — push notification handler
- `vite.config.ts` — manifest + PWA setup
