# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands(Edited)

- `npm run dev` — Vite dev server on port 5173 (binds `0.0.0.0` for LAN/phone access). PWA dev mode is enabled (`devOptions.enabled: true`), so the service worker registers even in dev.
- `npm run build` — runs `tsc -b` then `vite build`. Type errors fail the build; there is no separate `typecheck` script.
- `npm run preview` — serves `dist/` for a quick sanity check.
- `npm run lint` — runs `eslint .`. **No eslint config is checked in**, so this will currently fail; either add a config or skip until one exists.
- `npm run test` — **Vitest** unit/component layer (jsdom, no backend needed). Fast pre-commit check. Tests are co-located as `src/**/*.test.ts(x)` and excluded from `tsc -b` (the build). `npm run test:watch` for watch mode. Covers the retry policy (`lib/queryRetry`), the Sentry scrubbers (`lib/sentry`), the `ErrorBoundary`, and the auth client (`api/client.test.ts` — refresh-failure classification, single-flight, 401-retry-once).
- `npm run test:e2e` — Playwright, backend-backed. Specs: `smoke.spec.ts` (contractor happy path: register → new estimate → add item → share → support section → logout → landing), `contractor-journey.spec.ts` (deeper journey from the manual scenario: honest 0-metrics + FREE plan, company-logo upload → preview → delete, catalog seed + manual add, estimate items with correct totals; plus the FREE 2-object limit), `reliability.spec.ts` (backend-down → friendly error screen + retry recovers), and `landing.spec.ts` (guest sees the public landing; CTAs → /register & /login). **Requires the backend on `:8080`** (it checks reachability and fails fast otherwise); the Vite dev server is auto-started, or reused if already on 5173. `npm run test:e2e:ui` opens the debug UI. (`contractor-journey.spec.ts` runs first alphabetically, so it eats the cold-Vite compile — its registration timeout is deliberately generous.) **Register rate-limit caveat:** the backend caps `POST /api/auth/register` at **5/hour/IP** (Fix I), and the suite registers ~4 fresh users per run — so several reruns within one hour will 429. Restart the backend to reset its in-memory bucket, or relax the limit in the backend dev profile. Steps needing real infra (email verification, PDF render, the client portal + signing, push) stay manual in `C:\Work\E2E-TEST-SCENARIO.md`.

## Roadmap & project docs — reconcile every iteration

This PWA is one half of a two-repo project; the shared docs drift fast, so **update and cross-check** them before starting and after finishing each chunk:

- `C:\Work\SPEC.md` — canonical roadmap + status (section F steps, G future work). Move statuses ⏳ → 🔄 → ✅ and tick chunk boxes as work lands.
- `C:\Work\PROMPTS.md` — per-step prompt archive; keep its TOC + heading statuses matching SPEC.
- `CLAUDE.md` (this file) — keep commands, conventions and paths current.
- `docs/open-questions.md` — the `open-questions` skill walks it at the start of every iteration; log new deferred items here.

The backend lives in `C:\Work\majstr-backend\`; mirror any backend DTO change into `src/api/types.ts` in lockstep.

## Mobile-first — priority #1 (verify on every change)

**~95% of masters use this PWA on a phone.** Mobile is the primary target, not an
afterthought — this holds for **every** change, from a headline feature down to a
one-line fix.

- Design and build every UI/UX change for a **narrow phone viewport first**
  (≈375px), then let it scale up — never desktop-first.
- **Verify the mobile layout before finishing UI work**: open the Browser pane and
  `resize_window` to preset `mobile` (375×812). Check: no horizontal overflow,
  tap targets big enough, text readable, primary actions in the thumb zone, and
  modals rendered as fitting sheets (prefer bottom sheets / full-width controls
  over desktop dialogs).
- If a change touches the UI but can't be mobile-verified in the moment, say so
  explicitly instead of assuming desktop is enough.

## Architecture

### What this repo is

A standalone React 19 + TypeScript PWA. It is the **client only**. The Spring Boot backend lives in the sibling repo at `C:\Work\majstr-backend\` (controllers under `src/main/java/com/majstr/backend/controller/`, DTOs under `.../dto/`). All non-UI state — users, plans, projects, estimates, catalog, files — comes from that backend over REST.

### Backend coupling

The two repos are tightly coupled by contract, not by build:

- `src/api/types.ts` mirrors Spring DTOs **verbatim**. If a backend field is renamed/dropped, TS compilation here will silently keep the old shape until a `/me` or similar call returns the new payload at runtime — when changing backend DTOs, update this file in lockstep.
- The backend reads `app.cors.allowed-origins` (env: `CORS_ALLOWED_ORIGINS`). Dev defaults include `http://localhost:5173`. **Any new origin (different port, LAN IP for phone testing, ngrok URL) must be added on the backend side** or the browser blocks the call before it leaves.
- `VITE_API_BASE_URL` (default `http://localhost:8080`) is the only thing pointing this app at the backend.

### Auth flow (the central nervous system)

Three files own auth and they must stay in sync:

1. `src/lib/tokens.ts` — token storage. **localStorage by design** (PWA boot-from-home-screen needs persistence; trade-offs documented in the file). `httpOnly` cookies are the planned upgrade once the backend supports them.
2. `src/api/client.ts` — the axios instance with two interceptors:
   - request: if the access token's `exp` has **already passed** (decoded client-side, 10s skew), refresh **before sending** — we never fire a request with a known-expired token and bounce off a 401 (this is what prevents the expired-JWT-hammering loop). Then attach `Authorization: Bearer <accessToken>`.
   - response: on 401 (token looked valid but server rejected it), refresh once and retry the original request a single time (`_retry` guard).
   - Refresh is **single-flight** via the module-level `refreshInFlight` promise (shared by both interceptors *and* `ensureAccessToken`) — don't introduce a parallel refresh path or you'll race-rotate the refresh token. **Refresh failures are classified** (`doRefresh`): a **4xx** from `/api/auth/refresh` (or no refresh token) means the token is genuinely dead → resolve `null` → `forceLogin()` clears storage and redirects to `/login` **once** (`redirectingToLogin` latch). A **network error or 5xx** is transient → `doRefresh` **rejects** (doesn't resolve null), so the original request fails like any other transient failure with **tokens kept** — we never log the user out over a blip/backend hiccup. `/api/auth/login` and `/api/auth/refresh` are excluded from the 401 logic; `rawApi` skips the bearer entirely (login, register). Bearer calls outside axios (PDF blob `fetch`) must call the exported `ensureAccessToken()` to get the same proactive-refresh guarantee. Covered by `src/api/client.test.ts`.
3. `src/routes/ProtectedRoute.tsx` — auth gate driven by `useMe()`. Decision tree: no token → redirect; token present + `/me` pending → spinner; `/me` errored with **401/403** → clear tokens + redirect to `/login`; `/me` errored **transiently** (network/5xx) → keep tokens + show `ErrorState` with retry (logging out over a blip would lose the session for nothing). `useMe` follows the global retry policy (transient retried, 4xx not).

The backend **rotates the refresh token on every `/api/auth/refresh`** (old token → 401) and the refresh TTL is 30 days (`REFRESH_TOKEN_TTL_DAYS`); `doRefresh` therefore stores the *new* refresh token from each response. `useLogout` calls the public `POST /api/auth/logout {refreshToken}` (via `rawApi`) to **revoke the token server-side** — best-effort/fire-and-forget so it never blocks local logout — before `tokens.clear()`. The involuntary `forceLogin()` path doesn't revoke (the refresh token is already dead, which is why refresh failed).

`useLogin` primes the `['me']` cache with the user from the login response so the dashboard renders without a second `/me` round-trip.

### PWA / service worker

- Uses `vite-plugin-pwa` with the **`injectManifest` strategy** (not `generateSW`). The custom SW at `src/sw.ts` precaches the app shell, handles `push` and `notificationclick`, and **never caches `/api/**`** (user-specific data). If switching strategies, you lose the ability to handle push.
- The SW calls `skipWaiting()` + `clients.claim()` on install/activate, and `registerType: 'autoUpdate'` is set in `main.tsx`, so users land on the new build on next navigation.
- Web push is wired end-to-end (Step 8): the Profile "Сповіщення" toggle → `usePush` → `pushApi`. `usePush.enable()` fetches the VAPID public key from **`GET /api/push/vapid-public-key`** at runtime (not an env var — there is no `VITE_VAPID_PUBLIC_KEY` any more), requests permission **only on the click**, subscribes, and POSTs the **flat** payload `{endpoint, p256dh, auth, userAgent}` to `/api/push/subscribe`. Disable POSTs `/api/push/unsubscribe`. The key is cached in a module-level promise for the page lifetime. Backend fans push out on estimate-sign / client-question.
- iOS web push requires the PWA to be installed via Safari → Add to Home Screen on iOS 16.4+; `PushManager` is absent in a plain mobile-Safari tab. The Profile row detects this (`isIOS() && !isStandalone()`) and shows an "add to home screen" hint instead of a dead toggle.
- **Self-healing subscriptions:** the browser silently rotates a push subscription (SW reinstall, push-service key rotation) and the backend then pushes to a dead endpoint that FCM accepts (201) but nothing displays. To fix this, `AppLayout` calls `resyncPushSubscription()` (in `usePush.ts`) on every app open to re-POST the current subscription (upsert), and the SW handles `pushsubscriptionchange` by re-subscribing with the same VAPID key + `postMessage`-ing open clients to re-sync. The SW itself can't call the bearer-protected `/api/push/subscribe`, so the app (which has the token) does the POST. Without this, rotated users silently stop getting push until they re-toggle.

### Reliability & error handling

Production-readiness block (BLOCK 1). The goal: *we* hear about a crash first, the user sees a friendly screen (never a blank white page), and form data survives a failed request.

- **Sentry** (`src/lib/sentry.ts`): `@sentry/react`, **env-gated on `VITE_SENTRY_DSN`** — empty DSN (the dev default) means `Sentry.init` is never called, so nothing is collected or sent. `initSentry()` runs first thing in `main.tsx`. Privacy: `sendDefaultPii: false`; `beforeSend`/`beforeBreadcrumb` scrub Authorization/cookie headers, **redact auth-call request bodies**, drop token-shaped query params, and drop breadcrumbs for `/api/auth/*`. User is tagged by **id only** (no email/name) — `setSentryUser` from `useLogin`/`AppLayout`, cleared in `useLogout`. `VITE_SENTRY_ENVIRONMENT` is an optional dev/prod tag (defaults to Vite build mode).
- **Global Error Boundary** (`src/components/ErrorBoundary.tsx`): wraps the app in `main.tsx`; a render crash shows the friendly "Щось пішло не так" + "Оновити сторінку" screen and reports via `captureException`. It accepts a custom `fallback` render-prop for per-surface screens. The default fallback uses `i18n.t(...)` (not the hook) with hardcoded UA defaults so it renders even if the tree/i18n is broken.
- **Friendly network errors**: `src/components/ErrorState.tsx` (reusable "Сервіс тимчасово недоступний" + retry for a failed query's `isError` branch — wired into Dashboard/Projects/Catalog/etc.) and `src/components/OfflineBanner.tsx` (sticky banner driven by `online`/`offline` events, mounted in `App.tsx`). Toasts already carry plain-language UA messages via `toAppError()`.
- **Form data is never lost on error**: forms are react-hook-form and we **never call `reset()` on an error path** — values stay so the user can just retry.
- **Query retry policy** (`shouldRetryQuery` in `main.tsx`): retry **only** transient failures — no-response (network/offline/timeout) and **5xx** — up to 3× with exponential backoff (cap 10s). **Never retry 4xx** (401/403/404/409/422/**429**): deterministic, retrying wastes time / hammers the server. **Mutations keep the default no-retry** to avoid duplicate writes.
- **Client portal resilience is NOT in this repo**: the portal where a client opens an estimate is a **vanilla page server-rendered by the backend** (SPEC Step 3), not a React PWA surface — harden it in `majstr-backend`.

### Conventions

- Path alias `@/*` → `src/*` (configured in both `tsconfig.app.json` and `vite.config.ts`). Use it instead of relative `../../` chains.
- TypeScript is `strict` including `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`. `import type { ... }` is required for type-only imports — a plain `import` will fail the build.
- React Query defaults are set in `main.tsx` (`staleTime: 30s`, `refetchOnWindowFocus: false`, and a `retry` policy — see Reliability below); they're chosen for mobile feel, not test convenience.
- All env access goes through `src/lib/config.ts`. Don't read `import.meta.env` from anywhere else.
- All thrown errors should go through `toAppError()` from `src/api/errors.ts` to get a Ukrainian user-facing message + structured backend payload.
- **UI strings go through i18n** (Step 9). No hardcoded user-facing text — use `const { t } = useTranslation()` then `t('namespace.key')` in components, and `import i18n from '@/lib/i18n.ts'` + `i18n.t(...)` in non-component modules (zod schemas, `errors.ts`). Keys live in `src/locales/uk.json` + `en.json` (keep both **structurally identical**), grouped by surface (`common/nav/auth/dashboard/projects/estimate/catalog/profile/questions/email/errors/validation` + shared enum maps `units/trades/status/itemType`). Default language is `uk`; detection is localStorage-only (`majstr.lang`) so an English browser isn't shown the en stubs. There's no UI language switcher yet (G2). Enum→label goes via `t('trades.'+x)` etc.; badge **variants** stay in `labels.ts` (`PROJECT_STATUS_VARIANT`/`ESTIMATE_STATUS_VARIANT`). Money/number/date formatting stays in `src/lib/format.ts`. Code, comments, commit messages, and docs stay in English.

### Public landing

`/` is a gate (`HomeRoute` in `routes.tsx`): **no token in storage → the public marketing `LandingPage`** (`src/features/landing/`, zero API calls so it paints instantly); **token present → the dashboard inside `AppLayout`** (unchanged — `AppLayout` now takes optional `children`, falling back to `<Outlet/>` for the other authed routes). The landing has its own visual identity (warm-oak/paper/bright-orange, technical-drawing feel) via a separate `landing-*` Tailwind palette + `--l-*` CSS vars + `font-mono` — kept distinct from the app theme so neither drifts. Copy is i18n (`landing.*`), contacts come from `config.supportEmail/Phone`. SEO meta/OG live statically in `index.html`; prerender/SSR of `/` is a deferred open-question (the authed app stays client-only). The client portal (backend-served) is untouched.

### Feature folder layout

`src/features/<surface>/` holds the pages and the hooks/schemas they own (e.g. `LoginPage.tsx` + `loginSchema.ts` + `useLogin.ts`). Cross-cutting hooks (`useToast`, `usePush`) live in `src/hooks/`. Add new surfaces as sibling folders rather than splitting them across `pages/` and `hooks/` top-level dirs.
