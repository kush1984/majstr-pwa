import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');
const css = read('src/styles/index.css');
const tailwindConfig = read('tailwind.config.js');

/**
 * ~95 % of masters use this on a phone, and the failure mode of losing these rules is the worst
 * kind: nothing looks broken, the button simply does not answer every time. Reported from the
 * field as «не можливо анселектнути чекбокс… з 5-того разу спрацювало» — a press that lands on
 * the TEXT inside a control starts a native text selection, and the browser then never dispatches
 * the `click`.
 *
 * Asserted against the stylesheet as TEXT for the same reason `swUpdate.test.ts` reads `sw.ts`:
 * there is no component to render that would prove a base-layer rule is still shipped, and a
 * mocked assertion would only prove the mock knows about it. The portal page (other repo) carries
 * the same block — see `PortalTouchTargetsTest` there.
 */
describe('touch-reliability base layer', () => {
  it('opts controls out of the double-tap-to-zoom wait', () => {
    expect(css).toContain('touch-action: manipulation');
  });

  it('stops a press on a control from starting a text selection that swallows the click', () => {
    expect(css).toContain('user-select: none');
    expect(css).toContain('-webkit-touch-callout: none');
  });

  it('covers the elements that are actually tapped, not only <button>', () => {
    for (const selector of ["[role='button']", "[role='checkbox']", "[role='menuitem']", 'summary', 'label']) {
      expect(css, `selector ${selector} must be in the touch block`).toContain(selector);
    }
  });

  it('gives a press its own feedback', () => {
    expect(css).toMatch(/button:active:not\(:disabled\)/);
  });

  /**
   * Not cosmetic: a phone has no hover but fakes one, so the last-tapped control keeps its `hover:`
   * look until something else is tapped — and «it still looks pressed» is exactly how the master
   * decides his tap did not land. Tailwind's own flag is the only place this can be fixed once for
   * every `hover:` utility in the app.
   */
  it('confines Tailwind hover utilities to devices that actually hover', () => {
    expect(tailwindConfig).toContain('hoverOnlyWhenSupported: true');
  });
});
