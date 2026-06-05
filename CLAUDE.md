# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server on port 5173 (binds `0.0.0.0` for LAN/phone access). PWA dev mode is enabled (`devOptions.enabled: true`), so the service worker registers even in dev.
- `npm run build` — runs `tsc -b` then `vite build`. Type errors fail the build; there is no separate `typecheck` script.
- `npm run preview` — serves `dist/` for a quick sanity check.
- `npm run lint` — runs `eslint .`. **No eslint config is checked in**, so this will currently fail; either add a config or skip until one exists.
- `npm run test:e2e` — Playwright smoke test of the contractor happy path (register → new estimate → add item → share). **Requires the backend on `:8080`** (it checks reachability and fails fast otherwise); the Vite dev server is auto-started, or reused if already on 5173. `npm run test:e2e:ui` opens the debug UI. No unit-test runner yet (Vitest is a deferred open-question).

## Roadmap & project docs — reconcile every iteration

This PWA is one half of a two-repo project; the shared docs drift fast, so **update and cross-check** them before starting and after finishing each chunk:

- `C:\Work\SPEC.md` — canonical roadmap + status (section F steps, G future work). Move statuses ⏳ → 🔄 → ✅ and tick chunk boxes as work lands.
- `C:\Work\PROMPTS.md` — per-step prompt archive; keep its TOC + heading statuses matching SPEC.
- `CLAUDE.md` (this file) — keep commands, conventions and paths current.
- `docs/open-questions.md` — the `open-questions` skill walks it at the start of every iteration; log new deferred items here.

The backend lives in `C:\Work\majstr-backend\`; mirror any backend DTO change into `src/api/types.ts` in lockstep.

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
   - Refresh is **single-flight** via the module-level `refreshInFlight` promise (shared by both interceptors *and* `ensureAccessToken`) — don't introduce a parallel refresh path or you'll race-rotate the refresh token. When refresh can't produce a token, `forceLogin()` clears storage and redirects to `/login` **once** (`redirectingToLogin` latch), and pending requests reject instead of retrying forever. `/api/auth/login` and `/api/auth/refresh` are excluded from the 401 logic; `rawApi` skips the bearer entirely (login, register). Bearer calls outside axios (PDF blob `fetch`) must call the exported `ensureAccessToken()` to get the same proactive-refresh guarantee.
3. `src/routes/ProtectedRoute.tsx` — auth gate driven by `useMe()`. Decision tree: no token → redirect; token present + `/me` pending → spinner; `/me` errored → redirect (interceptor already cleared tokens on a failed refresh).

The backend **rotates the refresh token on every `/api/auth/refresh`** (old token → 401) and the refresh TTL is 30 days (`REFRESH_TOKEN_TTL_DAYS`); `doRefresh` therefore stores the *new* refresh token from each response. `useLogout` calls the public `POST /api/auth/logout {refreshToken}` (via `rawApi`) to **revoke the token server-side** — best-effort/fire-and-forget so it never blocks local logout — before `tokens.clear()`. The involuntary `forceLogin()` path doesn't revoke (the refresh token is already dead, which is why refresh failed).

`useLogin` primes the `['me']` cache with the user from the login response so the dashboard renders without a second `/me` round-trip.

### PWA / service worker

- Uses `vite-plugin-pwa` with the **`injectManifest` strategy** (not `generateSW`). The custom SW at `src/sw.ts` precaches the app shell, handles `push` and `notificationclick`, and **never caches `/api/**`** (user-specific data). If switching strategies, you lose the ability to handle push.
- The SW calls `skipWaiting()` + `clients.claim()` on install/activate, and `registerType: 'autoUpdate'` is set in `main.tsx`, so users land on the new build on next navigation.
- Web push is wired end-to-end (Step 8): the Profile "Сповіщення" toggle → `usePush` → `pushApi`. `usePush.enable()` fetches the VAPID public key from **`GET /api/push/vapid-public-key`** at runtime (not an env var — there is no `VITE_VAPID_PUBLIC_KEY` any more), requests permission **only on the click**, subscribes, and POSTs the **flat** payload `{endpoint, p256dh, auth, userAgent}` to `/api/push/subscribe`. Disable POSTs `/api/push/unsubscribe`. The key is cached in a module-level promise for the page lifetime. Backend fans push out on estimate-sign / client-question.
- iOS web push requires the PWA to be installed via Safari → Add to Home Screen on iOS 16.4+; `PushManager` is absent in a plain mobile-Safari tab. The Profile row detects this (`isIOS() && !isStandalone()`) and shows an "add to home screen" hint instead of a dead toggle.
- **Self-healing subscriptions:** the browser silently rotates a push subscription (SW reinstall, push-service key rotation) and the backend then pushes to a dead endpoint that FCM accepts (201) but nothing displays. To fix this, `AppLayout` calls `resyncPushSubscription()` (in `usePush.ts`) on every app open to re-POST the current subscription (upsert), and the SW handles `pushsubscriptionchange` by re-subscribing with the same VAPID key + `postMessage`-ing open clients to re-sync. The SW itself can't call the bearer-protected `/api/push/subscribe`, so the app (which has the token) does the POST. Without this, rotated users silently stop getting push until they re-toggle.

### Conventions

- Path alias `@/*` → `src/*` (configured in both `tsconfig.app.json` and `vite.config.ts`). Use it instead of relative `../../` chains.
- TypeScript is `strict` including `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`. `import type { ... }` is required for type-only imports — a plain `import` will fail the build.
- React Query defaults are set in `main.tsx` (`staleTime: 30s`, `retry: 1`, `refetchOnWindowFocus: false`); they're chosen for mobile feel, not test convenience.
- All env access goes through `src/lib/config.ts`. Don't read `import.meta.env` from anywhere else.
- All thrown errors should go through `toAppError()` from `src/api/errors.ts` to get a Ukrainian user-facing message + structured backend payload.
- **UI strings go through i18n** (Step 9). No hardcoded user-facing text — use `const { t } = useTranslation()` then `t('namespace.key')` in components, and `import i18n from '@/lib/i18n.ts'` + `i18n.t(...)` in non-component modules (zod schemas, `errors.ts`). Keys live in `src/locales/uk.json` + `en.json` (keep both **structurally identical**), grouped by surface (`common/nav/auth/dashboard/projects/estimate/catalog/profile/questions/email/errors/validation` + shared enum maps `units/trades/status/itemType`). Default language is `uk`; detection is localStorage-only (`majstr.lang`) so an English browser isn't shown the en stubs. There's no UI language switcher yet (G2). Enum→label goes via `t('trades.'+x)` etc.; badge **variants** stay in `labels.ts` (`PROJECT_STATUS_VARIANT`/`ESTIMATE_STATUS_VARIANT`). Money/number/date formatting stays in `src/lib/format.ts`. Code, comments, commit messages, and docs stay in English.

### Feature folder layout

`src/features/<surface>/` holds the pages and the hooks/schemas they own (e.g. `LoginPage.tsx` + `loginSchema.ts` + `useLogin.ts`). Cross-cutting hooks (`useToast`, `usePush`) live in `src/hooks/`. Add new surfaces as sibling folders rather than splitting them across `pages/` and `hooks/` top-level dirs.
