/**
 * «Чек №N» — the name the SERVER gives a receipt saved without one (it alone knows the N). It is a
 * stand-in, not something the master typed: shown as the field's placeholder so typing replaces it
 * rather than appending to it, and so a name read off the paper may still fill the field.
 */
export function isServerReceiptName(label: string | null | undefined): boolean {
  return /^Чек №\d+$/.test((label ?? '').trim());
}

/** The label field's starting text: empty when the server named the receipt, the master's own name otherwise. */
export function editableReceiptLabel(label: string | null | undefined): string {
  return isServerReceiptName(label) ? '' : (label ?? '');
}
