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
