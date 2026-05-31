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
- **Status:** OPEN
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
- **Status:** OPEN
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

### Offline fallback / network indicator
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** SW precaches the app shell, so the React app boots
  offline — but then every `/api/*` call fails, axios surfaces "Сервер
  недоступний", and there is no global indicator that the user is
  offline. Confusing UX.
- **Notes / options:** Subscribe to `online` / `offline` events; show a
  sticky banner. Background-sync queueing for mutations is much later.

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
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** `useLogout` only clears localStorage. The refresh token
  stays valid in the backend DB until natural expiry — stealing it
  from a logged-out shared device still works.
- **Notes / options:** Backend adds `POST /api/auth/logout` that revokes
  the supplied refresh token; PWA hits it before clearing storage.

### Password reset UI
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** `LoginPage` already has a TODO comment for "Забули
  пароль?". Blocked on backend endpoints + email transport.
- **Notes / options:** Two screens: `/forgot-password` (email →
  `POST /api/auth/forgot`) and `/reset-password?token=...` (new
  password form). Pure UI work once backend ships.

### Email verification flow
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** `useRegister` auto-logs in on success. When the backend
  adds email confirmation, the register response won't carry tokens
  any more — needs a "перевір пошту" intermediate screen and a
  `/verify-email?token=...` route.
- **Notes / options:** Detect by response shape (no `accessToken` →
  navigate to confirmation screen). Pure client change once backend
  switches.

---

## Backend coupling

### `POST /api/push/subscribe` is a 404
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** `src/api/push.ts` defines a payload (endpoint +
  expirationTime + p256dh + auth keys) and POSTs it. The backend
  endpoint doesn't exist yet — the button shows "✓ Сповіщення
  увімкнено" but no push ever arrives.
- **Notes / options:** Block on backend. When it lands, verify the DTO
  matches what Java expects; current shape mirrors the standard
  `PushSubscriptionJSON` interface so it should slot in cleanly.

### VAPID public key wiring
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** `.env.example` ships `VITE_VAPID_PUBLIC_KEY=` empty. With
  no key, `usePush.enable()` short-circuits with a Ukrainian error.
  Need the backend to generate a keypair, expose the public half, and
  document setup.
- **Notes / options:** Simplest: backend admin command prints it once,
  devs paste into `.env`. Cleaner: fetch from `/api/config/public` at
  app boot — single source of truth, no copy-paste drift.

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

### No test runner
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** Zero coverage of the refresh-token interceptor,
  `ProtectedRoute` state machine, form validation, or push lifecycle
  — exactly the bits that bite hardest when they regress.
- **Notes / options:** Vitest + React Testing Library for
  components/hooks; MSW to mock the backend without spinning Spring
  Boot. Playwright e2e for the install + login happy path is a later
  step.

### Client-side error reporting
- **Status:** OPEN
- **Since:** initial scaffold
- **Context:** Uncaught errors disappear into the user's DevTools. We
  hear about bugs only when someone reports them in Ukrainian over
  Viber.
- **Notes / options:** Sentry SDK + source-map upload on `vite build`.
  Cheap and same provider the backend will likely use.

---

## Resolved

(nothing yet — when items close, move them here with a one-line resolution and the commit SHA)
