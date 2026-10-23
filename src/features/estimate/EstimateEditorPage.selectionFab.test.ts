import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * In selection mode the «＋» floated over the selection bar and covered its «Скасувати» (a master's
 * screenshot). The bar owns the bottom while picking, the same way it hides the summary sheet.
 * Asserted against the source like the page's other guards: it is too large to render here.
 */
const source = readFileSync(resolve(process.cwd(), 'src/features/estimate/EstimateEditorPage.tsx'), 'utf8');

describe('EstimateEditorPage — the selection bar owns the bottom', () => {
  it('hides the «＋» while lines are being picked', () => {
    const fab = source.split('\n').find((l) => l.includes('<Fab '));
    expect(fab).toBeDefined();
    expect(fab).toContain('picked === null');
  });
});
