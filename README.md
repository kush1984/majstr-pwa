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

These PNGs are committed. To regenerate them from the brand mark:

```bash
npm run generate-icons
```

`scripts/generate-icons.mjs` rasterizes the orange tile + white "M"
(drawn as a stroked vector path, so no system font is needed) with
`@resvg/resvg-js`: a rounded tile for the `any` icons, a full-bleed
variant with the logo inside the 80% safe zone for `maskable`, and a
180px `apple-touch-icon`. Re-run it after changing the mark.

## Testing web push

Service workers and `Notification.requestPermission()` require a **secure
context**. `http://localhost` counts as secure, so the whole push flow
works on the desktop with zero TLS setup. A phone is *not* localhost, so
it needs real HTTPS.

### On the desktop (fastest — recommended first)

1. Backend running on `:8080`, then `npm run dev`.
2. Open **`http://localhost:5173` in Chrome** (or Edge).
3. Profile → **Сповіщення** → toggle on → allow the browser prompt.
4. Open the estimate's client portal link, **sign the estimate** (or
   leave a question) → a push notification appears.

No HTTPS, no tunnel, no CORS change needed — `localhost` is enough.

### On a phone (real HTTPS via one tunnel)

A self-signed LAN cert does **not** work: phones refuse to register a
service worker on a cert error. Use a tunnel that gives a real cert. The
trick below routes the API through the **Vite dev proxy** so the browser
only ever sees one origin — no mixed-content, and nothing extra to add to
the backend's `CORS_ALLOWED_ORIGINS`.

1. In `.env` (or `.env.local`) set the API base **empty** so the app uses
   relative `/api` URLs (the proxy forwards them to `:8080`):
   ```
   VITE_API_BASE_URL=
   ```
2. `npm run dev` (the dev server already binds `0.0.0.0`).
3. In another terminal, expose port 5173 over HTTPS. Either:
   - **cloudflared** (free, real cert): `cloudflared tunnel --url http://localhost:5173`
   - **localtunnel**: `npx localtunnel --port 5173`
   - or **ngrok**: `ngrok http 5173`
   These providers' domains are pre-listed in `vite.config.ts`
   `server.allowedHosts` (Vite 6 blocks unknown Host headers). For a
   provider not listed there, add its domain or set `allowedHosts: true`.
4. Open the `https://…` URL the tunnel prints **on the phone**.
5. **iOS only:** Safari → Share → *Add to Home Screen*, then open the
   installed app. iOS delivers web push **only** to an installed PWA on
   16.4+ — the Profile row shows an install hint until you do this.
6. Enable Сповіщення and trigger a push as in the desktop steps.

> Why empty `VITE_API_BASE_URL`? With an absolute `http://localhost:8080`
> base, the phone can't reach your laptop's localhost and an HTTPS page
> can't call an HTTP API anyway. Relative URLs + the Vite `/api` proxy
> keep everything on the tunnel's single HTTPS origin.

## Web push

The **Profile → "Сповіщення"** toggle owns the subscription lifecycle
(`usePush`). Turning it on:

1. fetches the VAPID public key from `GET /api/push/vapid-public-key`
   (the keypair lives only on the backend — no `VITE_VAPID_*` env var)
2. `Notification.requestPermission()` — fired **only on the click**
3. `pushManager.subscribe()` with that key
4. `POST /api/push/subscribe` with the flat payload
   `{ endpoint, p256dh, auth, userAgent }`

Turning it off `POST`s `/api/push/unsubscribe`. The backend sends a push
when a client signs an estimate or leaves a question on the portal; the
service worker (`src/sw.ts`) shows the notification and routes the click.

**iOS caveat:** Apple ships web push only for PWAs installed via *Add
to Home Screen* on iOS 16.4+ — `PushManager` doesn't exist in a plain
mobile-Safari tab. The Profile row detects this and shows an install
hint instead of a toggle.

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
