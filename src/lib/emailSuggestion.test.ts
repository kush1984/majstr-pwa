import { describe, expect, it } from 'vitest';
import { suggestEmail } from './emailSuggestion.ts';

describe('suggestEmail — a typo after the @', () => {
  it.each([
    ['ivan@gmal.com', 'ivan@gmail.com'],
    ['ivan@gmail.con', 'ivan@gmail.com'],
    ['ivan@gmail.co', 'ivan@gmail.com'],
    ['ivan@gamil.com', 'ivan@gmail.com'],
    ['ivan@gmailcom', 'ivan@gmail.com'],
    ['ivan@ukr.ne', 'ivan@ukr.net'],
    ['ivan@ukrnet', 'ivan@ukr.net'],
    ['ivan@i.au', 'ivan@i.ua'],
    ['ivan@outlok.com', 'ivan@outlook.com'],
    ['ivan@icloud.cm', 'ivan@icloud.com'],
  ])('%s → %s', (typed, meant) => {
    expect(suggestEmail(typed)).toBe(meant);
  });

  it('keeps what was typed before the @, and ignores spaces around', () => {
    expect(suggestEmail('  Ivan.Petrenko+work@GMAL.COM ')).toBe('Ivan.Petrenko+work@gmail.com');
  });

  it.each([
    ['a popular domain', 'ivan@gmail.com'],
    ['a popular domain in capitals', 'ivan@Gmail.Com'],
    ['a real domain one letter from gmail.com', 'ivan@mail.com'],
    ['a company domain', 'ivan@romashka.ua'],
    ['a short domain two edits away', 'ivan@x.ru'],
    ['a throwaway two letters from hotmail.com — a stranger\'s box, not a typo', 'ivan@yopmail.com'],
    ['two typos at once', 'ivan@gmial.con'],
    ['no @', 'ivan'],
    ['nothing after the @', 'ivan@'],
  ])('suggests nothing for %s', (_, typed) => {
    expect(suggestEmail(typed)).toBeNull();
  });
});
