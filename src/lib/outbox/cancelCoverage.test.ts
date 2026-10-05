import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every optimistic patch must cancel the fetches it is about to overwrite (review P-31).
 *
 * <p>The race: a GET already in flight resolves AFTER the patch and writes server state — which
 * does not yet contain the queued op — straight over it. What the master just entered leaves the
 * screen for as long as that request takes, which on a shopping list in a basement, or a payment on
 * a money screen, is the feature failing in front of him. `cancelQueries` is TanStack's own answer
 * and the reason its optimistic-update guide opens with it.</p>
 *
 * <p>It was fixed in two hooks when the review named them, and the same shape was then found in
 * seven more — which is the point of this test rather than of those fixes. Nothing about a missing
 * `cancel` is visible: the code type-checks, lints, and works perfectly on every fast connection
 * and in every test, because a race needs a slow request to lose to. So this reads the SOURCE and
 * asks that every `offlineMutate` whose `optimistic` callback touches the cache carries one.</p>
 *
 * <p>An op that patches NOTHING is exempt by stating so — `optimistic: () => undefined`, which is
 * what a caller writes when it has already patched the cache itself on both paths.</p>
 */
const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'locales' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Each `offlineMutate<…>({ … })` call's body, with the file and line it starts on. */
function calls(): { where: string; body: string }[] {
  const found: { where: string; body: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    // Brace-counting from the opening `({`, so a nested object member cannot end the match early.
    const opener = /offlineMutate(?:<[^>]*>)?\(\{/g;
    for (let m = opener.exec(text); m !== null; m = opener.exec(text)) {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < text.length && depth > 0; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
      }
      found.push({
        where: `${file.slice(SRC.length).replace(/\\/g, '/')}:${text.slice(0, m.index).split('\n').length}`,
        body: text.slice(m.index + m[0].length, i - 1),
      });
    }
  }
  return found;
}

const all = calls();

describe('optimistic patches cancel what they overwrite', () => {
  it('finds the call sites at all — a regex matching nothing would pass forever', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it('gives every cache-touching op a `cancel`', () => {
    const missing = all
      // «I patch nothing» said out loud is the exemption; anything else patches something.
      .filter(({ body }) => !body.includes('optimistic: () => undefined'))
      .filter(({ body }) => !/\bcancel\b/.test(body))
      .map(({ where }) => where);
    expect(missing, 'these patch the cache without cancelling the fetches in flight').toEqual([]);
  });
});
