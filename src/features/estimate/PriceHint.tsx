import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { catalogApi } from '@/api/catalog.ts';
import type { ItemType, PriceHintResponse, Region, Unit } from '@/api/types.ts';
import { useDebouncedValue } from '@/hooks/useDebouncedValue.ts';
import { formatMoney } from '@/lib/format.ts';

/** Shorter than this the name is still being typed — no request for «Мо». */
const MIN_NAME = 3;

/** Where «Порівняти» looks — the sites masters named; a label is what the row shows. */
export const COMPARE_SITES = [
  { label: 'rabotniki', site: 'rabotniki.ua' },
  { label: 'kabanchik', site: 'kabanchik.ua' },
  { label: 'budver', site: 'budver.com' },
  { label: 'OLX', site: 'olx.ua' },
] as const;

function compareUrl(site: string, work: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${site} ${work} ціна`)}`;
}

/**
 * «Ринок: ~350 ₴ за м²» under the price field — a master's request: «коли я ставлю ціну за роботу,
 * щоб воно підказувало, яка ± ціна на таку позицію по ринку». The figure comes from OUR data only
 * (his oblast's median, else country × oblast factor, else the country median, else the library's price); nothing is fetched
 * from another site. «Порівняти» names several public sites (owner, 2026-11-26: «не тільки на
 * работніках»); each opens a web search of that site for the same work, so he can look further himself.
 * A search through Google, not each site's own search page — one URL shape that cannot break when a
 * site moves its search.
 *
 * Works only, online only — offline the line simply isn't there (no queue, no stale guess). With no
 * figure of ours (an unknown name answers 204) only the «Порівняти» row shows.
 */
export function PriceHint({ name, unit, type, online }: {
  name: string;
  unit: Unit;
  type: ItemType;
  online: boolean;
}) {
  const { t } = useTranslation();
  const debounced = useDebouncedValue(name.trim(), 400);
  const enabled = online && type === 'WORK' && unit !== 'PERCENT' && debounced.length >= MIN_NAME;
  const { data } = useQuery({
    queryKey: ['price-hint', debounced, unit],
    queryFn: () => catalogApi.priceHint(debounced, unit),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  // «Порівняти» stands under every work, our figure or not (owner, 2026-11-26): the sites matter most
  // exactly when we know nothing about the work.
  if (!enabled) return null;

  return (
    <div className="-mt-2 text-xs text-muted" data-testid="price-hint">
      {data && <p>{hintText(data, unit, t)}</p>}
      <p className="flex flex-wrap items-baseline gap-x-1">
        <span>{t('priceHint.compare')}</span>
        {COMPARE_SITES.map(({ label, site }) => (
          <a key={site} href={compareUrl(site, debounced)} target="_blank" rel="noopener noreferrer"
             className="px-1 py-1 font-semibold text-brand">
            {label}
          </a>
        ))}
      </p>
    </div>
  );
}

function place(region: Region, t: (k: string, o?: Record<string, unknown>) => string): string {
  return region === 'KYIV_CITY' ? t('regions.KYIV_CITY') : t('priceHint.oblast', { name: t(`regions.${region}`) });
}

function hintText(h: PriceHintResponse, unit: Unit,
                  t: (k: string, o?: Record<string, unknown>) => string): string {
  const vars = { price: formatMoney(h.price), unit: t(`units.${unit}`) };
  if (h.level === 'OBLAST' && h.region) {
    return t('priceHint.inOblast', { ...vars, place: place(h.region, t), count: h.mastersCount ?? 0 });
  }
  if (h.level === 'OBLAST_ESTIMATE' && h.region) {
    return t('priceHint.estimate', { ...vars, place: place(h.region, t) });
  }
  return t('priceHint.country', vars);
}
