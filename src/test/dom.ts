/**
 * Narrowing helpers for Testing Library queries.
 *
 * `getByRole` / `getByLabelText` are typed `HTMLElement`, which has no `value`, `checked` or
 * `disabled` — so reading those was a type error in every test that did it (invisible until
 * the test sources were type-checked).
 *
 * A bare `as HTMLInputElement` would silence it, but silently: point a query at the wrong
 * node and you get `undefined`, which compares unequal to both `true` and `false` and reads
 * as a confusing assertion failure rather than "you selected the wrong element". These assert
 * at runtime instead, so the test fails saying exactly what it actually matched.
 */

export function asInput(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`expected an <input>, matched <${el.tagName.toLowerCase()}>`);
  }
  return el;
}

export function asButton(el: HTMLElement): HTMLButtonElement {
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error(`expected a <button>, matched <${el.tagName.toLowerCase()}>`);
  }
  return el;
}
