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
   - request: attaches `Authorization: Bearer <accessToken>`.
   - response: on 401, refreshes via `/api/auth/refresh` and retries the original request. A module-level `refreshInFlight` promise **deduplicates concurrent 401s** — don't introduce a parallel refresh path or you'll race-rotate the refresh token. `/api/auth/login` and `/api/auth/refresh` are explicitly excluded from the refresh logic to avoid loops. Use the exported `rawApi` for endpoints that must skip the bearer (login, register).
3. `src/routes/ProtectedRoute.tsx` — auth gate driven by `useMe()`. Decision tree: no token → redirect; token present + `/me` pending → spinner; `/me` errored → redirect (interceptor already cleared tokens on a failed refresh).

`useLogin` primes the `['me']` cache with the user from the login response so the dashboard renders without a second `/me` round-trip.

### PWA / service worker

- Uses `vite-plugin-pwa` with the **`injectManifest` strategy** (not `generateSW`). The custom SW at `src/sw.ts` precaches the app shell, handles `push` and `notificationclick`, and **never caches `/api/**`** (user-specific data). If switching strategies, you lose the ability to handle push.
- The SW calls `skipWaiting()` + `clients.claim()` on install/activate, and `registerType: 'autoUpdate'` is set in `main.tsx`, so users land on the new build on next navigation.
- Web push subscribe flow exists end-to-end (`EnablePushButton` → `usePush` → `pushApi.subscribe`), but **the backend `/api/push/subscribe` endpoint is a known TODO and currently 404s**. The client side stays subscribed locally; whoever lands the backend will likely only need to verify the payload shape.
- iOS web push requires the PWA to be installed via Safari → Add to Home Screen on iOS 16.4+. The button is a no-op in regular mobile Safari.

### Conventions

- Path alias `@/*` → `src/*` (configured in both `tsconfig.app.json` and `vite.config.ts`). Use it instead of relative `../../` chains.
- TypeScript is `strict` including `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`. `import type { ... }` is required for type-only imports — a plain `import` will fail the build.
- React Query defaults are set in `main.tsx` (`staleTime: 30s`, `retry: 1`, `refetchOnWindowFocus: false`); they're chosen for mobile feel, not test convenience.
- All env access goes through `src/lib/config.ts`. Don't read `import.meta.env` from anywhere else.
- All thrown errors should go through `toAppError()` from `src/api/errors.ts` to get a Ukrainian user-facing message + structured backend payload.
- **UI strings are in Ukrainian** (lang `uk` in the manifest). Code, comments, commit messages, and docs stay in English.

### Feature folder layout

`src/features/<surface>/` holds the pages and the hooks/schemas they own (e.g. `LoginPage.tsx` + `loginSchema.ts` + `useLogin.ts`). Cross-cutting hooks (`useToast`, `usePush`) live in `src/hooks/`. Add new surfaces as sibling folders rather than splitting them across `pages/` and `hooks/` top-level dirs.
