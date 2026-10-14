import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';

/**
 * The boot screen in index.html: every launch of the installed app used to flash the landing's
 * static copy (it lives in #root for crawlers) until the bundle mounted. An inline script marks
 * `<html class="app-boot">` for anyone who is not a fresh visitor on "/", and CSS turns the copy
 * into a logo. Read as TEXT, like the other index.html guards — no mock can see this file.
 */
const root = path.resolve(__dirname, '../..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const headers = readFileSync(path.join(root, 'public', '_headers'), 'utf8');
const tokensSource = readFileSync(path.join(root, 'src', 'lib', 'tokens.ts'), 'utf8');

const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

function boot(pathname: string, stored: Record<string, string>): boolean {
  document.documentElement.classList.remove('app-boot');
  localStorage.clear();
  for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
  window.history.replaceState(null, '', pathname);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- running index.html's own inline script is the point
  new Function(script)();
  return document.documentElement.classList.contains('app-boot');
}

afterEach(() => {
  document.documentElement.classList.remove('app-boot');
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('index.html boot screen', () => {
  it('runs in <head>, before the static copy is painted', () => {
    expect(html.indexOf("classList.add('app-boot')")).toBeLessThan(html.indexOf('<body class='));
  });

  it('a fresh visitor on "/" — and so a crawler — still gets the landing copy', () => {
    expect(boot('/', {})).toBe(false);
  });

  it('a signed-in master on "/" gets the logo screen', () => {
    expect(boot('/', { 'majstr.accessToken': 'a' })).toBe(true);
    expect(boot('/', { 'majstr.refreshToken': 'r' })).toBe(true);
  });

  it('any other path gets the logo screen, signed in or not', () => {
    expect(boot('/projects', {})).toBe(true);
  });

  it('reads the same storage keys the app writes', () => {
    for (const key of ['majstr.accessToken', 'majstr.refreshToken']) {
      expect(tokensSource).toContain(`'${key}'`);
      expect(script).toContain(`'${key}'`);
    }
  });

  it('hides the copy by a class on #root > main, never by its wording', () => {
    expect(html).toContain('.app-boot #root > main');
    expect(html).toContain('<main style=');
  });

  it('is allowed by the CSP: its sha256 is in script-src', () => {
    const hash = createHash('sha256').update(script, 'utf8').digest('base64');
    expect(headers).toContain(`'sha256-${hash}'`);
  });
});
