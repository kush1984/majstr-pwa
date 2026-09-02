import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import uk from '@/locales/uk.json';
import en from '@/locales/en.json';

/**
 * A missing translation fails SILENTLY — i18next renders the key itself, so «acts.addAdditional
 * FromCatalog» shipped as a modal TITLE and only a screenshot from the master found it. Nothing
 * else can: the key is a plain string, so it type-checks, lints and renders without a warning, and
 * a component test asserting on `t('…')` output would have to name the very key that is missing.
 *
 * <p>So this walks the source instead. It reads every STATIC `t('some.key')` — a call whose whole
 * argument is one quoted literal — and asserts both bundles carry it. A key built at runtime
 * (`t('trades.' + code)`, `t(needle ? 'a' : 'b')`) is deliberately skipped rather than guessed at:
 * this test is a floor, not a proof.</p>
 */
const SRC = join(process.cwd(), 'src');

/** `t('a.b')` / `t('a.b', {…})` only — a trailing `+`, `?` or `.` means the key is composed. */
const STATIC_T = /\bt\(\s*'([a-zA-Z0-9_.]+)'\s*[,)]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'locales' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

function lookup(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) =>
      node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
    bundle,
  );
}

/** A counted key is stored under its plural forms, never bare — `newQuestions_one`, `…_few`,
 *  `…_many` in Ukrainian, `…_one`/`…_other` in English. Any one of them means it is translated. */
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];
const translated = (bundle: unknown, key: string) =>
  typeof lookup(bundle, key) === 'string' ||
  PLURAL_SUFFIXES.some((suffix) => typeof lookup(bundle, key + suffix) === 'string');

describe('translation keys', () => {
  const used = new Map<string, string>(); // key → the first file that asks for it
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const [, key] of text.matchAll(STATIC_T)) {
      if (!key.includes('.')) continue; // `t(x)` over a variable named like a word, not a key
      if (!used.has(key)) used.set(key, file.slice(SRC.length).replace(/\\/g, '/'));
    }
  }

  it('finds the keys to check at all — a regex that matches nothing would pass everything', () => {
    expect(used.size).toBeGreaterThan(300);
  });

  it('has a Ukrainian string for every static key the app renders', () => {
    const missing = [...used].filter(([key]) => !translated(uk, key));
    expect(missing.map(([key, file]) => `${key} (${file})`)).toEqual([]);
  });

  it('has an English string for every static key the app renders', () => {
    const missing = [...used].filter(([key]) => !translated(en, key));
    expect(missing.map(([key, file]) => `${key} (${file})`)).toEqual([]);
  });
});
