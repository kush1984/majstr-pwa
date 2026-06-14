# Open questions & deferred decisions

A living log of things we **noticed** but **chose not to do yet**. The
goal is that nothing important quietly disappears between iterations:
before each new step we skim this file and ask whether any item is in
scope for the work about to start.

Per-item shape:

```
### Short title
- **Status:** OPEN | IN_PROGRESS | DEFERRED | RESOLVED
- **Since:** step N (or date)
- **Context:** why this is a question
- **Notes / options:** thinking, links, paths considered
- **Resolution:** filled when closed
```

When you take an item, change its status to `IN_PROGRESS` and link the
commit / PR that resolves it. When you close it, set `RESOLVED` with a
one-line summary — keep the item in the file as a record.

---

## PWA & service worker

### App icons not generated
- **Status:** RESOLVED
- **Since:** initial scaffold
- **Context:** `vite.config.ts` manifest references `/icons/icon-192.png`,
  `/icons/icon-512.png`, `/icons/icon-maskable-512.png`; `index.html`
  references `/icons/apple-touch-icon.png`. Only `public/logo.svg` is
  committed — none of those PNGs exist. Result: manifest warnings in
  DevTools, generic icon in the Add-to-Home-Screen prompt on Android
  and iOS.
- **Notes / options:** Run the `pwa-asset-generator` commands from the
  README once and commit the PNGs to `public/icons/`. Or swap to a
  single SVG icon with `purpose: "any"` — least fuss but still no iOS
  icon coverage.
- **Resolution:** Step 8 — added `scripts/generate-icons.mjs`
  (`npm run generate-icons`, uses `@resvg/resvg-js`) which rasterizes the
  brand mark — the "M" drawn as a stroked vector path, no font dependency —
  into all four PNGs under `public/icons/`. Committed. Rounded tile for
  "any", full-bleed with the logo inside the 80% safe zone for maskable,
  180px for apple-touch-icon. Re-run the script if the brand mark changes.

### Service worker update UX
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** `main.tsx` calls `registerSW({ immediate: true })` with
  `autoUpdate`, but both `onNeedRefresh` and `onOfflineReady` are
  no-ops. Users silently get the new build on next navigation — no
  toast, no manual refresh button. In-progress form data is lost
  without warning.
- **Notes / options:** Show a toast ("Доступна нова версія, оновити?")
  with a button that calls the `updateSW()` returned by `registerSW`.
  Trade-off: more clicks vs. surprise reloads.

### HTTPS for LAN phone testing
- **Status:** RESOLVED
- **Since:** initial scaffold
- **Context:** Service worker registration and
  `Notification.requestPermission()` both refuse to run on plain HTTP
  except for `localhost`. Today the README points at `ngrok` or
  `mkcert` ad-hoc; opening `http://192.168.x.y:5173` on the phone
  doesn't actually exercise the PWA features the user is trying to
  test.
- **Notes / options:** Add `vite-plugin-basic-ssl` (or document the
  `mkcert` flow) so `npm run dev -- --https` Just Works for phone
  testing.
- **Resolution:** Step 8 — went a different (better) way than basic-ssl,
  which doesn't help phones (a cert error blocks SW registration). For
  push testing the README now documents two paths: **desktop** push works
  on `http://localhost` with no TLS at all (the recommended quick check);
  **phone** uses a real-cert tunnel (cloudflared/ngrok) plus the new Vite
  `/api` dev proxy, so setting `VITE_API_BASE_URL=` empty makes the app
  use relative URLs and everything stays on the tunnel's single HTTPS
  origin — no mixed-content, no extra backend CORS entry. (`config.ts`
  now uses `??` so an explicitly-empty base URL is honoured.)

### Offline fallback / network indicator
- **Status:** RESOLVED
- **Since:** initial scaffold
- **Context:** SW precaches the app shell, so the React app boots
  offline — but then every `/api/*` call fails, axios surfaces "Сервер
  недоступний", and there is no global indicator that the user is
  offline. Confusing UX.
- **Notes / options:** Subscribe to `online` / `offline` events; show a
  sticky banner. Background-sync queueing for mutations is much later.
- **Resolution:** Reliability block (BLOCK 1) — `OfflineBanner` (in `App.tsx`)
  subscribes to `online`/`offline` and shows a sticky amber banner while
  disconnected; the reusable `ErrorState` shows "Сервіс тимчасово недоступний"
  + retry on failed fetches. **Background-sync queueing for mutations is still
  deferred** (a separate, bigger piece of work).

---

## Auth & sessions

### httpOnly cookie migration for tokens
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** `src/lib/tokens.ts` documents the trade-off — localStorage
  is XSS-vulnerable, but the backend returns tokens in the JSON body
  today. A real XSS in any dependency would leak both access and
  refresh tokens to an attacker.
- **Notes / options:** Backend switches `/api/auth/login` + `/refresh`
  to set `Secure; HttpOnly; SameSite=Strict` cookies; this app deletes
  `tokens.ts`, sets `withCredentials: true` on axios. CORS gets
  stricter (no `*` for `Access-Control-Allow-Origin`).

### Multi-tab refresh-token race
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** `refreshInFlight` in `src/api/client.ts` dedupes
  concurrent 401s **within one tab**. Two tabs each hit 401 at the
  same instant — they race on `/api/auth/refresh`, and the loser's
  rotated refresh token gets invalidated, kicking the user out.
- **Notes / options:** Coordinate via `BroadcastChannel('majstr-auth')`
  or a `Web Locks` mutex. Real-world impact is rare (refresh windows
  are long), so probably defer until anyone reports being kicked out.

### Backend logout endpoint
- **Status:** RESOLVED
- **Since:** initial scaffold
- **Context:** `useLogout` only clears localStorage. The refresh token
  stays valid in the backend DB until natural expiry — stealing it
  from a logged-out shared device still works.
- **Notes / options:** Backend adds `POST /api/auth/logout` that revokes
  the supplied refresh token; PWA hits it before clearing storage.
- **Resolution:** Refresh-token audit — backend shipped public
  `POST /api/auth/logout {refreshToken}` (revokes server-side). `useLogout`
  now calls `authApi.logout(refreshToken)` (best-effort, fire-and-forget, never
  blocks local logout) before `tokens.clear()`. Verified live: a refresh token
  used after logout is rejected 401. (Backend also rotates refresh on every
  `/refresh` — old token → 401 — and TTL is 30 days via `REFRESH_TOKEN_TTL_DAYS`.)

### Password reset UI
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** `LoginPage` already has a TODO comment for "Забули
  пароль?". Blocked on backend endpoints + email transport.
- **Notes / options:** Two screens: `/forgot-password` (email →
  `POST /api/auth/forgot`) and `/reset-password?token=...` (new
  password form). Pure UI work once backend ships.

### Email verification flow
- **Status:** RESOLVED
- **Since:** initial scaffold
- **Context:** `useRegister` auto-logs in on success. When the backend
  adds email confirmation, the register response won't carry tokens
  any more — needs a "перевір пошту" intermediate screen and a
  `/verify-email?token=...` route.
- **Notes / options:** Detect by response shape (no `accessToken` →
  navigate to confirmation screen). Pure client change once backend
  switches.
- **Resolution:** Step 7 — chose the *soft* variant (not a hard "перевір пошту"
  gate): register still auto-logs in; unverified users get a soft banner + a
  public `/verify-email?token=...` page, and only sharing is gated
  (403 `EMAIL_NOT_VERIFIED` → modal). Lives in `src/features/email/`. Verified
  live (browser + DB confirmed `email_verified=t`) and via the E2E share step.

---

## Backend coupling

### `POST /api/push/subscribe` is a 404
- **Status:** RESOLVED
- **Since:** initial scaffold
- **Context:** `src/api/push.ts` defines a payload (endpoint +
  expirationTime + p256dh + auth keys) and POSTs it. The backend
  endpoint doesn't exist yet — the button shows "✓ Сповіщення
  увімкнено" but no push ever arrives.
- **Notes / options:** Block on backend. When it lands, verify the DTO
  matches what Java expects; current shape mirrors the standard
  `PushSubscriptionJSON` interface so it should slot in cleanly.
- **Resolution:** Step 8 — backend shipped `POST /api/push/subscribe`
  (upsert by endpoint) + `POST /api/push/unsubscribe`. The real DTO is
  **flat** (`endpoint, p256dh, auth, userAgent`), not the nested
  `PushSubscriptionJSON` shape — `usePush.subscriptionToPayload` now
  flattens it. Push fans out on estimate-sign / client-question.

### VAPID public key wiring
- **Status:** RESOLVED
- **Since:** initial scaffold
- **Context:** `.env.example` ships `VITE_VAPID_PUBLIC_KEY=` empty. With
  no key, `usePush.enable()` short-circuits with a Ukrainian error.
  Need the backend to generate a keypair, expose the public half, and
  document setup.
- **Notes / options:** Simplest: backend admin command prints it once,
  devs paste into `.env`. Cleaner: fetch from `/api/config/public` at
  app boot — single source of truth, no copy-paste drift.
- **Resolution:** Step 8 — took the "cleaner" option. The PWA fetches
  the key from `GET /api/push/vapid-public-key` (`{publicKey: string|null}`,
  cached for the page lifetime) inside `enable()`; `null` → "не налаштовані
  на сервері". Removed `VITE_VAPID_PUBLIC_KEY` from `config.ts`,
  `vite-env.d.ts`, and `.env.example`. The keypair lives only on the
  backend (`VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT`).

### Manual DTO mirroring in `src/api/types.ts`
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** Types are hand-mirrored from Spring DTOs (documented in
  CLAUDE.md). If the backend renames a field nothing breaks at compile
  time on this side — the call just returns runtime-undefined for the
  old name.
- **Notes / options:** Generate types from OpenAPI
  (`openapi-typescript` against Springdoc's `/v3/api-docs`). Adds a
  build step. Worth it once the surface area grows past auth.

---

## Domain UI (Step 6)

### Per-estimate total + item count not in EstimateSummary
- **Status:** OPEN
- **Since:** step 6
- **Context:** `EstimateSummary` (the project-detail estimates list) has no
  `total` or item count, so `ProjectDetailPage` fetches each estimate in
  full (`GET /api/estimates/{id}`) just to show the sum + "N позицій". N+1,
  but N is usually 1 — acceptable for now.
- **Notes / options:** Add `total` + `itemCount` to `EstimateSummary` on the
  backend (same shape the project card already got via Fix B). Then drop the
  per-row fetch.

### Project card has a neutral icon (no trade on project)
- **Status:** OPEN
- **Since:** step 6
- **Context:** Mockups show per-type project icons (tile/electric/plumb/office).
  `ProjectResponse` has no trade/type field, so every card uses a neutral 📁.
- **Notes / options:** Either add a `trade`/`icon` to the project (backend), or
  let the user pick an icon on create. Low priority — cosmetic.

### Plan project-limit is a client-side constant
- **Status:** OPEN
- **Since:** step 6
- **Context:** Profile's limit bar reads `FREE = 3` from a constant in
  `ProfilePage.tsx` (used count is real, from `GET /api/projects`). The real
  enforcement lives in the backend `LimitService`; the client just mirrors the
  number for display, which drifts if the limit changes.
- **Notes / options:** Expose the limit on `/me` (e.g. `maxProjects`) so the UI
  reads one source of truth.

### Logo upload UI is a stub
- **Status:** RESOLVED
- **Since:** step 6
- **Context:** `POST /api/profile/logo` exists, but the Profile "Логотип
  компанії" row only toasts for PRO users — no file picker / crop / preview yet.
- **Notes / options:** Build the upload sheet (multipart, 2 MB, PNG/JPEG)
  once branded PDF matters to a paying user.
- **Resolution:** Logo step — the `LogoRow` now does upload / preview /
  replace / delete. `profileApi.uploadLogo(file)` POSTs multipart to
  `/api/profile/logo` (Content-Type unset so the browser adds the boundary;
  still bearer-authed via the `api` instance), `deleteLogo()` hits DELETE;
  `useUploadLogo`/`useDeleteLogo` prime `['me']`. Client validation (PNG/JPEG,
  ≤2 MB to match the backend cap) with friendly toasts, spinner while in
  flight, `<img>` preview from `config.apiBaseUrl + logoUrl`, delete behind a
  `ConfirmDialog`. **Available on every plan** (the logo brands the free client
  portal); FREE users get a hint that the logo on the **PDF** is a PRO perk
  (`BRANDED_PDF`). Backend was already complete (storage, public
  `/api/files/**`, PDF + portal usage) — this was pure frontend. Covered by the
  `contractor-journey` e2e (upload → preview → delete). No crop yet (deferred).

### In-app notifications (bell + per-object client questions)
- **Status:** RESOLVED
- **Since:** step 8
- **Context:** Web push (Step 8) surfaces client questions / signatures only as
  **OS notifications** — there is nothing inside the app. The question text lives
  solely in the push body; project detail has no "questions" view, so a
  contractor who misses or dismisses the toast can't recover the question, and
  there's no unread indicator anywhere in the UI.
- **Notes / options:** Add an in-app notifications surface — a bell with an
  unread counter in the header + a per-object list of client questions (and
  sign events), with mark-as-read state. Needs a **backend endpoint** to list
  questions for the contractor (e.g. `GET /api/projects/{id}/questions`, or a
  unified `GET /api/notifications`) since `EstimateQuestion` isn't exposed to the
  authenticated API yet — only written from the public portal. Bonus: the SW can
  `postMessage` open clients so a live in-app toast shows when a push arrives
  while the app is already open.
- **Resolution:** Fix F — backend shipped `GET /api/projects/{id}/questions`,
  `PATCH .../{qid}/read`, and `unreadQuestions` per project. PWA added a
  "Питання від клієнта" section on the project screen (opening marks unread
  read), a "💬 N" card indicator, and a header **NotificationBell** whose
  counter/list aggregate `unreadQuestions` across the projects list (no global
  endpoint needed). The live SW→client toast bonus is still future work.

---

## Quality & tooling

### ESLint config missing
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** `npm run lint` runs `eslint majstr-pwa` (wrong target —
  the project root *is* `majstr-pwa`, should be `eslint .`) and there
  is no `eslint.config.js` committed, so the command fails either way.
  Net: no linting in CI or locally. CLAUDE.md flags this.
- **Notes / options:** Add `eslint@9` flat config + `@typescript-eslint`,
  `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`. Fix the
  script to `eslint .` while at it.

### No unit / component test runner (E2E smoke exists)
- **Status:** RESOLVED
- **Since:** initial scaffold
- **Context:** A Playwright E2E smoke now guards the contractor happy path
  (`npm run test:e2e`, see README). Still missing a fast unit/component layer
  for the refresh-token interceptor, `ProtectedRoute` state machine, form
  validation, money/label formatting, and the push lifecycle.
- **Notes / options:** Vitest + React Testing Library for components/hooks;
  MSW to mock the backend without spinning Spring Boot. Runs without a
  backend — good for pre-commit.
- **Resolution:** Reliability block (BLOCK 1) — added **Vitest** + React
  Testing Library (`npm run test`, jsdom, no backend), config in
  `vitest.config.ts`, tests co-located as `src/**/*.test.ts(x)` (excluded from
  `tsc -b`). First specs cover the new reliability surface: retry policy
  (`lib/queryRetry`), Sentry scrubbers (`lib/sentry`), and `ErrorBoundary`.
  The runner is now in place; **broader coverage** (refresh-token interceptor,
  `ProtectedRoute`, form validation, formatting, push lifecycle, MSW) is the
  natural follow-up to grow incrementally.

### Client-side error reporting
- **Status:** RESOLVED
- **Since:** initial scaffold
- **Context:** Uncaught errors disappear into the user's DevTools. We
  hear about bugs only when someone reports them in Ukrainian over
  Viber.
- **Notes / options:** Sentry SDK + source-map upload on `vite build`.
  Cheap and same provider the backend will likely use.
- **Resolution:** Reliability block (BLOCK 1) — added `@sentry/react`
  (`src/lib/sentry.ts`), env-gated on `VITE_SENTRY_DSN` (empty → disabled, the
  dev default). Captures unhandled + React render errors (the global
  `ErrorBoundary` forwards via `captureException`). `beforeSend`/
  `beforeBreadcrumb` scrub Authorization/cookie headers, auth-call request
  bodies and token-shaped query params; `sendDefaultPii: false`; user tagged by
  id only (login + AppLayout, cleared on logout). Source-map upload on
  `vite build` is still TODO (needs the Sentry CLI/auth token at deploy time).

### Register rate-limit conflicts with the e2e suite
- **Status:** OPEN
- **Since:** e2e scenario coverage
- **Context:** The backend caps `POST /api/auth/register` at 5/hour/IP (Fix I,
  anti-spam). The Playwright suite registers ~4 fresh users per run, so two or
  three runs within the same hour from one IP start getting 429 and the tests
  fail at the registration step (stuck on `/register`) — a false red.
- **Notes / options:** Relax the limit in the backend **dev/test profile**
  (e.g. much higher cap or disabled for localhost), which is the clean fix and
  lives in `majstr-backend`. Workarounds today: restart the backend (the
  Bucket4j bucket is in-memory, so it resets), or keep registrations per run
  minimal (the suite already shares one registration across the read-only
  journey checks). A PWA-side option would be seeding a user via a test-only
  endpoint, but that's also a backend change.

### Landing SEO — no prerender/SSR for the public home
- **Status:** OPEN
- **Since:** landing step
- **Context:** The public landing lives at `/` and is rendered client-side by
  the SPA (`HomeRoute` → `LandingPage`). Crawlers that execute JS will index it,
  and the core meta/OG tags are static in `index.html` so even non-JS crawlers
  see title/description. But there's no server-rendered/prerendered HTML of the
  marketing copy itself — weaker for SEO than a static page would be.
- **Notes / options:** Add a build-time prerender of just `/` (e.g.
  `vite-plugin-prerender` / a small `puppeteer` step, or `vite-react-ssg`) that
  emits a static `index.html` with the hero/sections baked in, while the rest of
  the app stays a plain SPA. Revisit when the landing goes to prod / we care
  about ranking. Keep it scoped to the public route — the authed app must stay
  client-only.

---

## Resolved

(nothing yet — when items close, move them here with a one-line resolution and the commit SHA)
