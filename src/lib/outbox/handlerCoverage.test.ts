import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import uk from '@/locales/uk.json';
import en from '@/locales/en.json';

/**
 * Every entity the app ever queues must have a handler registered in `init.ts`.
 *
 * <p>An op whose entity has no handler is not an error anywhere: `flushOutbox` does
 * `if (!handler) continue`, so the op is skipped by every flush, never retried, never blocked and
 * never surfaced. It just sits there counted as «pending». That is how «Отримати платіж» authored
 * with no signal (review P-33) showed the money as received, queued it against `payment-receipt`,
 * which nothing handled, and lost it at the next global invalidate — the optimistic cache entry
 * was overwritten by the server's untouched numbers and the queued op outlived the screen that
 * would have explained it.</p>
 *
 * <p>Nothing else can catch this. The entity is a plain string on both sides, so a call site and a
 * registration that disagree type-check, lint and run. So this reads the SOURCE: every `entity:`
 * literal handed to `offlineMutate`/`enqueue`/`enqueueLatest` must appear in a
 * `registerOutboxHandler('…')` call, and must have a `sync.entity.<name>` label in both bundles —
 * the sync sheet renders that key raw when it is missing.</p>
 */
const SRC = join(process.cwd(), 'src');
const INIT = join(SRC, 'lib', 'outbox', 'init.ts');

/** `entity: 'foo'` in an op literal. A composed entity name has never existed and must not. */
const USED = /\bentity:\s*'([a-zA-Z0-9_-]+)'/g;
const REGISTERED = /registerOutboxHandler\(\s*'([a-zA-Z0-9_-]+)'/g;
/** `registerOutboxHandler(ACT_RECEIPT_ENTITY, …)` — a name held in a constant. */
const REGISTERED_CONST = /registerOutboxHandler\(\s*([A-Z][A-Z0-9_]+)\s*,/g;
/** `export const ACT_RECEIPT_ENTITY = 'actReceipt'` — resolves the constant above. */
const ENTITY_CONST = /\b([A-Z][A-Z0-9_]*ENTITY)\s*(?::[^=]+)?=\s*'([a-zA-Z0-9_-]+)'/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'locales' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const files = sourceFiles(SRC);
const initText = readFileSync(INIT, 'utf8');

const constants = new Map<string, string>();
for (const file of files) {
  for (const [, name, value] of readFileSync(file, 'utf8').matchAll(ENTITY_CONST)) {
    constants.set(name, value);
  }
}

const registered = new Set<string>();
for (const [, name] of initText.matchAll(REGISTERED)) registered.add(name);
for (const [, constName] of initText.matchAll(REGISTERED_CONST)) {
  const value = constants.get(constName);
  if (value !== undefined) registered.add(value);
}

const used = new Map<string, string>(); // entity → the first file that queues it
for (const file of files) {
  if (file === INIT) continue; // the registrations themselves carry no `entity:` literal
  for (const [, name] of readFileSync(file, 'utf8').matchAll(USED)) {
    if (!used.has(name)) used.set(name, file.slice(SRC.length).replace(/\\/g, '/'));
  }
}

const label = (bundle: Record<string, unknown>, name: string) => {
  const sync = bundle.sync as { entity?: Record<string, unknown> } | undefined;
  return sync?.entity?.[name];
};

describe('outbox handler coverage', () => {
  it('finds both sides at all — a regex matching nothing would pass everything', () => {
    expect(used.size).toBeGreaterThan(15);
    expect(registered.size).toBeGreaterThan(15);
  });

  it('has a registered handler for every entity the app queues', () => {
    const missing = [...used].filter(([name]) => !registered.has(name))
      .map(([name, file]) => `${name} (queued in ${file})`);
    expect(missing).toEqual([]);
  });

  it('names every queued entity in both bundles, so the sync sheet never renders a raw key', () => {
    const missing = [...used.keys()].filter(
      (name) => typeof label(uk, name) !== 'string' || typeof label(en, name) !== 'string',
    );
    expect(missing).toEqual([]);
  });
});
