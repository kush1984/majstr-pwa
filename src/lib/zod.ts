import { z } from 'zod';

// By default zod probes for `new Function` while building a schema, and a strict CSP reports even a
// caught probe, so every page load would send a violation. Must run before any schema is built, which
// is why the app imports `z` from here (eslint enforces it).
z.config({ jitless: true });

export { z };
