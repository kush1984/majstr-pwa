/**
 * Whole packages for a quantity, always UP — half a bag is not sold. The calculator screen and the
 * shopping list both count from the number ON THE ROW, so a quantity the master corrected is what
 * the packages follow. The backend PDF (`ShoppingListPdfService.packageCount`) is the same rule.
 *
 * `Math.ceil` over a binary division over-counts on the exact case: 2.1 / 0.3 is 7.000000000000001,
 * so «7 мішків» became 8 and the master carried one he did not need (review P-29) — hence the 1e-9.
 *
 * Null when there is nothing to count: no package, or no positive quantity.
 */
export function packageCount(
  quantity: number | null | undefined,
  packageSize: number | null | undefined,
): number | null {
  if (quantity == null || packageSize == null) return null;
  if (!Number.isFinite(quantity) || !Number.isFinite(packageSize)) return null;
  if (quantity <= 0 || packageSize <= 0) return null;
  return Math.ceil(quantity / packageSize - 1e-9);
}
