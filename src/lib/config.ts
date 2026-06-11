/**
 * All env-driven values live here so the rest of the app never reads
 * `import.meta.env` directly. Cheap to mock in tests, easy to grep.
 */

export const config = {
  // `??` (not `||`) so an *explicitly empty* VITE_API_BASE_URL stays "" — that
  // makes axios use relative `/api/...` URLs, which the Vite dev proxy forwards
  // to the backend. Used for phone testing through a single HTTPS tunnel (one
  // origin → no mixed-content, no extra CORS origin). Unset → localhost default.
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080',
  // Note: the VAPID public key is no longer an env var — it's fetched at
  // runtime from GET /api/push/vapid-public-key (single source of truth).

  // Support contacts shown on the Profile screen. `||` (not `??`) on purpose:
  // an unset OR explicitly-empty env var falls back to the real defaults —
  // empty contacts are never useful.
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL || 'support@majstr.pro',
  supportPhone: import.meta.env.VITE_SUPPORT_PHONE || '+380978938990',

  // Sentry error reporting. Empty DSN → Sentry stays disabled (the local/dev
  // default), so it never gets in the way until prod sets a real DSN.
  sentryDsn: import.meta.env.VITE_SENTRY_DSN ?? '',
  // Environment tag sent with every event (dev/prod). Falls back to Vite's
  // build mode so we don't need an extra env var for the common case.
  sentryEnvironment:
    import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
} as const;

export const routes = {
  login: '/login',
  register: '/register',
  verifyEmail: '/verify-email',
  home: '/',
  projects: '/projects',
  catalog: '/catalog',
  profile: '/profile',
  newEstimate: '/new',
  project: (id: string) => `/projects/${id}`,
  estimate: (id: string) => `/estimates/${id}`,
} as const;
