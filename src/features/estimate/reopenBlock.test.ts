import { describe, it, expect } from 'vitest';
import i18n from '@/lib/i18n.ts';
import { reopenBlockFixableInActs, reopenBlockMessage } from './reopenBlock.ts';

const t = i18n.t.bind(i18n);

/** What the master reads instead of a reopen button that would only refuse (owner, 2026-11-24). */
describe('reopenBlockMessage', () => {
  it('one draft: delete it in «Акти»', () => {
    expect(reopenBlockMessage(t, { reason: 'DRAFT_ACT', actNumbers: ['4'] }))
      .toBe('Щоб перевідкрити, спершу видаліть чернетку акта № 4 у вкладці «Акти».');
  });

  it('several drafts: names them all, in the plural', () => {
    expect(reopenBlockMessage(t, { reason: 'DRAFT_ACT', actNumbers: ['2', '4'] }))
      .toBe('Щоб перевідкрити, спершу видаліть чернетки актів № 2, № 4 у вкладці «Акти».');
  });

  it('a sent act: back to draft, then delete', () => {
    expect(reopenBlockMessage(t, { reason: 'SENT_ACT', actNumbers: ['3'] }))
      .toMatch(/^Акт № 3 уже надіслано клієнту\. .*поверніть акт у чернетку й видаліть/);
  });

  it('a signed act: a new estimate, with or without a number', () => {
    expect(reopenBlockMessage(t, { reason: 'SIGNED_ACT', actNumbers: ['1'] }))
      .toMatch(/^Клієнт уже підписав акт № 1 .*новий кошторис\.$/);
    expect(reopenBlockMessage(t, { reason: 'SIGNED_ACT', actNumbers: [] }))
      .toMatch(/^Клієнт уже підписав акт за цим кошторисом/);
  });

  it('only drafts and sent acts lead to «Акти» — a signed act or a rollup has nothing to fix there', () => {
    expect(reopenBlockFixableInActs({ reason: 'DRAFT_ACT', actNumbers: ['1'] })).toBe(true);
    expect(reopenBlockFixableInActs({ reason: 'SENT_ACT', actNumbers: ['1'] })).toBe(true);
    expect(reopenBlockFixableInActs({ reason: 'SIGNED_ACT', actNumbers: ['1'] })).toBe(false);
    expect(reopenBlockFixableInActs({ reason: 'ADDENDUM', actNumbers: [] })).toBe(false);
  });
});
