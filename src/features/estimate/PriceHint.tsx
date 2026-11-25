import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { catalogApi } from '@/api/catalog.ts';
import type { ItemType, PriceHintResponse, Region, Unit } from '@/api/types.ts';
import { useDebouncedValue } from '@/hooks/useDebouncedValue.ts';
import { formatMoney } from '@/lib/format.ts';

/** Shorter than this the name is still being typed — no request for «Мо». */
const MIN_NAME = 3;

/**
 * «Ринок: ~350 ₴ за м²» under the price field — a master's request: «коли я ставлю ціну за роботу,
 * щоб воно підказувало, яка ± ціна на таку позицію по ринку». The figure comes from OUR data only
 * (his oblast's median, else country × oblast factor, else the library's price); nothing is fetched
 * from another site. «Порівняти» opens a web search of rabotniki.ua for the same work, so he can look
 * further himself.
 *
 * Works only, online only — offline the line simply isn't there (no queue, no stale guess).
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
  if (!enabled || !data) return null;

  const compare = `https://www.google.com/search?q=${encodeURIComponent(`site:rabotniki.ua ${debounced} ціна`)}`;
  return (
    <p className="-mt-2 flex flex-wrap items-baseline gap-x-2 text-xs text-muted" data-testid="price-hint">
      <span>{hintText(data, unit, t)}</span>
      <a href={compare} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand">
        {t('priceHint.compare')}
      </a>
    </p>
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
