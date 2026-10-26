import type { CatalogItemResponse, EstimateItemResponse, Trade } from '@/api/types.ts';
import { catalogKey, indexCatalog } from '@/lib/catalogMatch.ts';

/** A line whose price is not what the master's catalog says. */
export interface PriceDiff {
  key: string;
  line: EstimateItemResponse;
  catalog: CatalogItemResponse;
  /** The client price from the estimate — never the crew price. */
  price: number;
  /** Below the catalog: maybe a one-off discount for this client, so it is not ticked by default. */
  lower: boolean;
}

/** A line the catalog has no position for. */
export interface MissingPosition {
  key: string;
  line: EstimateItemResponse;
  price: number;
  trade: Trade;
}

export interface CatalogDivergence {
  differs: PriceDiff[];
  missing: MissingPosition[];
}

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * What the «Ціни відрізняються від каталогу» card is about. A line meets the catalog by
 * `catalogKey` (name + type + unit — what the server prices template lines by), and we never guess:
 * - a «%» line is skipped (its figure is a percent, not a price);
 * - a line at 0 ₴ is skipped (the catalog refuses 0, owner ruling);
 * - the same name in a DIFFERENT unit or type in the catalog → skipped, not «missing»;
 * - several lines naming one position at different prices → skipped (which one is the price?).
 * Only `unitPrice` is read — `sourceUnitPrice` (the crew price) never reaches the catalog.
 */
export function catalogDivergence(
  items: readonly EstimateItemResponse[],
  catalog: readonly CatalogItemResponse[],
): CatalogDivergence {
  const byKey = indexCatalog(catalog);
  const namesInCatalog = new Set(catalog.map((c) => nameKey(c.name)));
  const fallbackTrade = commonTrade(items);

  const groups = new Map<string, EstimateItemResponse[]>();
  for (const line of items) {
    if (line.unit === 'PERCENT' || !(line.unitPrice > 0)) continue;
    const key = catalogKey(line.name, line.type, line.unit);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  const differs: PriceDiff[] = [];
  const missing: MissingPosition[] = [];
  for (const [key, lines] of groups) {
    const price = lines[0].unitPrice;
    if (lines.some((l) => l.unitPrice !== price)) continue;
    const line = lines[0];
    const match = byKey.get(key);
    if (match) {
      if (match.defaultPrice !== price) {
        differs.push({ key, line, catalog: match, price, lower: price < match.defaultPrice });
      }
    } else if (!namesInCatalog.has(nameKey(line.name))) {
      missing.push({ key, line, price, trade: line.trade ?? fallbackTrade });
    }
  }
  return { differs, missing };
}

/** The estimate's trade: the one most of its lines carry, else «Інше». */
function commonTrade(items: readonly EstimateItemResponse[]): Trade {
  const counts = new Map<Trade, number>();
  for (const i of items) if (i.trade) counts.set(i.trade, (counts.get(i.trade) ?? 0) + 1);
  let best: Trade = 'OTHER';
  let n = 0;
  for (const [trade, c] of counts) if (c > n) { best = trade; n = c; }
  return best;
}

/** One divergence as a string: it changes when the line's price or the catalog's price changes. */
function signatures(d: CatalogDivergence): string[] {
  return [
    ...d.differs.map((x) => `p|${x.key}|${x.price}|${x.catalog.defaultPrice}`),
    ...d.missing.map((x) => `m|${x.key}|${x.price}`),
  ];
}

const storeKey = (estimateId: string) => `catalogSyncNotNow:${estimateId}`;

/** «Не зараз»: remember exactly what was on the card. Storage failing is fine — the card just shows. */
export function rememberNotNow(estimateId: string, d: CatalogDivergence): void {
  try {
    localStorage.setItem(storeKey(estimateId), JSON.stringify(signatures(d)));
  } catch {
    // Private mode, quota, blocked storage: nothing to do.
  }
}

/** The card shows when there is something to say AND some of it is new since «Не зараз». */
export function shouldShowCard(estimateId: string, d: CatalogDivergence): boolean {
  const current = signatures(d);
  if (current.length === 0) return false;
  try {
    const raw = localStorage.getItem(storeKey(estimateId));
    if (raw === null) return true;
    const seen = new Set(JSON.parse(raw) as unknown[]);
    return current.some((s) => !seen.has(s));
  } catch {
    return true;
  }
}
