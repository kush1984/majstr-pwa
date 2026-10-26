import type { CatalogItemResponse, ItemType, Unit } from '@/api/types.ts';

/**
 * The key a line meets the master's catalog by: `lower(trim(name))` + type + unit — exactly what the
 * server prices a template line by, and what `ux_catalog_items_owner_name_type_unit` makes unique.
 * NOT `CatalogNameKey`, the fuzzy dedup key, which deliberately glues different positions together.
 * A rename on either side breaks the match (see the `catalog_item_id` open question).
 */
export function catalogKey(name: string, type: ItemType, unit: Unit): string {
  return `${name.trim().toLowerCase()}\u0000${type}\u0000${unit}`;
}

/** The master's catalog indexed by {@link catalogKey}. */
export function indexCatalog(items: readonly CatalogItemResponse[]): Map<string, CatalogItemResponse> {
  const byKey = new Map<string, CatalogItemResponse>();
  for (const item of items) byKey.set(catalogKey(item.name, item.type, item.unit), item);
  return byKey;
}
