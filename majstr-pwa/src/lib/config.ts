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
  dashboard: '/dashboard',
} as const;
