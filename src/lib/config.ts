/**
 * All env-driven values live here so the rest of the app never reads
 * `import.meta.env` directly. Cheap to mock in tests, easy to grep.
 */

export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080',
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
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
