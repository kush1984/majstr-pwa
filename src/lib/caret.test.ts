import { describe, it, expect, afterEach } from 'vitest';
import { caretOffsetAt, wordAt, wordEndAt } from './caret.ts';

describe('wordEndAt — the caret moves to the end of the tapped word', () => {
  const name = "Укладання плитки 300×600 (м'яка підкладка)";

  it('from the start of a word', () => {
    expect(wordEndAt(name, 0)).toBe('Укладання'.length);
  });

  it('from the middle of a word', () => {
    expect(wordEndAt(name, name.indexOf('литки'))).toBe(name.indexOf(' 300'));
  });

  it('at the end of a word it stays', () => {
    expect(wordEndAt(name, 'Укладання'.length)).toBe('Укладання'.length);
  });

  it('on a space it stays', () => {
    const space = name.indexOf(' ');
    expect(wordEndAt(name, space)).toBe(space);
  });

  it('«×» splits 300×600 into two words', () => {
    expect(wordEndAt(name, name.indexOf('300') + 1)).toBe(name.indexOf('×'));
    expect(wordEndAt(name, name.indexOf('600'))).toBe(name.indexOf(' ('));
  });

  it('a bracket ends a word, and on a bracket it stays', () => {
    const open = name.indexOf('(');
    expect(wordEndAt(name, open)).toBe(open);
    expect(wordEndAt(name, name.indexOf('підкладка') + 2)).toBe(name.indexOf(')'));
  });

  it("an apostrophe is inside the word: «м'яка» and «обʼєкт» are one word each", () => {
    expect(wordEndAt(name, name.indexOf("м'яка"))).toBe(name.indexOf("м'яка") + "м'яка".length);
    expect(wordEndAt('обʼєкт', 0)).toBe('обʼєкт'.length);
  });

  it('a slash and a dash end a word; past the end is the end', () => {
    expect(wordEndAt('шт/м²', 0)).toBe(2);
    expect(wordEndAt('Монтаж — демонтаж', 1)).toBe('Монтаж'.length);
    expect(wordEndAt('Стяжка', 99)).toBe(6);
  });
});

describe('wordAt — what a double tap selects', () => {
  it('the whole word around the offset, apostrophe included', () => {
    const text = "Підкладка м'яка 300×600";
    expect(wordAt(text, text.indexOf("'"))).toEqual([text.indexOf("м'"), text.indexOf(' 300')]);
    expect(wordAt(text, text.indexOf('600') + 1)).toEqual([text.indexOf('600'), text.length]);
  });
});

describe('caretOffsetAt', () => {
  const stub = (name: 'caretPositionFromPoint' | 'caretRangeFromPoint', fn: () => unknown) =>
    Object.defineProperty(document, name, { value: fn, configurable: true, writable: true });
  afterEach(() => {
    Reflect.deleteProperty(document, 'caretPositionFromPoint');
    Reflect.deleteProperty(document, 'caretRangeFromPoint');
    document.body.innerHTML = '';
  });

  const span = (text: string) => {
    const el = document.createElement('span');
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  };

  it('reads the offset inside the container from caretPositionFromPoint', () => {
    const el = span('Затирка швів');
    stub('caretPositionFromPoint', () => ({ offsetNode: el.firstChild, offset: 4 }));
    expect(caretOffsetAt(el, 1, 1)).toBe(4);
  });

  it('falls back to caretRangeFromPoint', () => {
    const el = span('Затирка швів');
    stub('caretRangeFromPoint', () => ({ startContainer: el.firstChild, startOffset: 9 }));
    expect(caretOffsetAt(el, 1, 1)).toBe(9);
  });

  it('a hit outside the name, or no API at all, is null', () => {
    const el = span('Затирка');
    const other = span('Сусід');
    expect(caretOffsetAt(el, 1, 1)).toBeNull();
    stub('caretPositionFromPoint', () => ({ offsetNode: other.firstChild, offset: 2 }));
    expect(caretOffsetAt(el, 1, 1)).toBeNull();
  });
});
