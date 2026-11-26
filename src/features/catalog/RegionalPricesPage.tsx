import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { catalogApi } from '@/api/catalog.ts';
import { REGIONS, type CatalogItemResponse, type Region, type RegionalCatalogPriceRow } from '@/api/types.ts';
import { Chip } from '@/components/Chip.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { formatDate, formatMoney } from '@/lib/format.ts';
import { CatalogTabs } from './CatalogTabs.tsx';
import { toTradeTree } from './catalogTree.ts';
import { tradeBranchLabel } from './TradeLevel.tsx';
import { useVisibleCatalog } from './useCatalog.ts';

type Show = 'ALL' | 'OBLAST';

/**
 * «Ціни по областях» — a master's request: what the same work costs in another oblast. For every work
 * in HIS catalog: his price, the oblast's (a median of 3+ masters there, else «орієнтовно» = country ×
 * the oblast's factor) and the country's. Read-only; nothing is written to his catalog.
 *
 * <p>PRO (owner, 2026-11-25); the hint under the price field stays FREE. FREE sees the pitch, and the
 * backend refuses the data too. Names, folders and his own price come from the catalog he already has
 * cached — the response carries only the figures, keyed by catalog id.</p>
 */
export function RegionalPricesPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';
  const [picked, setPicked] = useState<Region | null>(null);
  const region: Region = picked ?? me?.region ?? 'KYIV_CITY';
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('ALL');

  const catalog = useVisibleCatalog();
  const prices = useQuery({
    queryKey: ['regional-prices', region],
    queryFn: () => catalogApi.regionalPrices(region),
    enabled: isPro,
    staleTime: 60 * 60 * 1000,
  });

  const byId = useMemo(
    () => new Map((prices.data?.items ?? []).map((r) => [r.itemId, r])),
    [prices.data],
  );
  const branches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (catalog.data ?? []).filter((i) => {
      const row = byId.get(i.id);
      if (!row) return false;
      // `== null`: the server leaves an absent level out of the JSON, so it arrives undefined.
      if (show === 'OBLAST' && row.level == null) return false;
      return needle === '' || i.name.toLowerCase().includes(needle);
    });
    return toTradeTree(rows);
  }, [catalog.data, byId, q, show]);

  const sortedRegions = useMemo(
    () => [...REGIONS].sort((a, b) => t(`regions.${a}`).localeCompare(t(`regions.${b}`), 'uk')),
    [t],
  );

  const header = (
    <>
      <h1 className="mb-4 text-2xl font-extrabold tracking-tight text-primary sm:text-[26px]">
        {t('catalog.title')}
      </h1>
      <CatalogTabs />
    </>
  );

  if (!isPro) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-surface p-4">
          <h2 className="mb-1 text-base font-bold text-primary">{t('regionalPrices.proTitle')}</h2>
          <p className="mb-4 text-sm text-secondary">{t('regionalPrices.proPitch')}</p>
          <UpgradeBanner text={t('regionalPrices.proHint')} trigger="REGIONAL_PRICES" />
        </div>
      </>
    );
  }

  const factor = prices.data?.factor;
  const showSearch = (catalog.data?.length ?? 0) > 8;

  return (
    <>
      {header}

      <div className="mb-2 flex items-center gap-2">
        <label className="text-sm font-semibold text-primary" htmlFor="regional-prices-region">
          {t('regionalPrices.region')}
        </label>
        {/* Select is w-full and `cn` does not merge classes: the wrapper sizes it to its text. */}
        <div className="min-w-0">
          <Select
            id="regional-prices-region"
            value={region}
            onChange={(e) => setPicked(e.target.value as Region)}
          >
            {sortedRegions.map((r) => (
              <option key={r} value={r}>{regionLabel(r, t)}</option>
            ))}
          </Select>
        </div>
      </div>
      <p className="mb-3 text-xs text-muted">
        {factor != null
          ? t('regionalPrices.factor', { percent: percentVsCountry(factor) })
          : t('regionalPrices.noFactor')}
        {prices.data?.computedAt ? ` · ${t('regionalPrices.asOf', { date: formatDate(prices.data.computedAt) })}` : ''}
      </p>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        <Chip active={show === 'ALL'} onClick={() => setShow('ALL')}>{t('common.all')}</Chip>
        <Chip active={show === 'OBLAST'} onClick={() => setShow('OBLAST')}>{t('regionalPrices.onlyOblast')}</Chip>
      </div>

      {showSearch && (
        <Input
          placeholder={t('estimate.searchCatalog')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-4"
        />
      )}

      {prices.isPending || catalog.isPending ? (
        <div className="flex justify-center py-10 text-brand">
          <Spinner />
        </div>
      ) : prices.isError ? (
        <ErrorState error={prices.error} title={t('regionalPrices.loadError')} onRetry={() => void prices.refetch()} />
      ) : branches.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          {q.trim() || show === 'OBLAST' ? t('catalog.nothingFound') : t('regionalPrices.empty')}
        </p>
      ) : (
        <div className="space-y-6" data-testid="regional-prices">
          {branches.map((branch) => (
            <section key={branch.key}>
              {branches.length > 1 && (
                <h2 className="mb-2 text-base font-bold text-primary">
                  {tradeBranchLabel(branch.key, branch.customName, t)}
                </h2>
              )}
              {branch.sections.map((section) => (
                <div key={section.category} className="mb-4">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {section.category === '' ? t('catalog.noCategory') : section.category}
                  </h3>
                  <ul className="divide-y divide-border rounded-card border border-border bg-surface">
                    {section.items.map((item) => {
                      const row = byId.get(item.id);
                      return row ? <PriceRow key={item.id} item={item} row={row} region={region} /> : null;
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function PriceRow({ item, row, region }: { item: CatalogItemResponse; row: RegionalCatalogPriceRow; region: Region }) {
  const { t } = useTranslation();
  const unit = t(`units.${item.unit}`);
  const oblast =
    row.level === 'OBLAST' && row.regionalPrice != null
      ? { price: formatMoney(row.regionalPrice), note: t('regionalPrices.masters', { count: row.mastersCount ?? 0 }) }
      : row.level === 'OBLAST_ESTIMATE' && row.regionalPrice != null
        ? { price: `~${formatMoney(row.regionalPrice)}`, note: t('regionalPrices.estimate') }
        : null;
  return (
    <li className="px-3 py-2.5">
      <p className="text-sm text-primary">
        {item.name} <span className="text-muted">· {unit}</span>
      </p>
      <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted">{t('regionalPrices.yours')}</dt>
          <dd className="font-semibold text-primary">{formatMoney(item.defaultPrice)}</dd>
        </div>
        <div>
          <dt className="truncate text-muted">{regionLabel(region, t)}</dt>
          <dd className="font-semibold text-primary">{oblast ? oblast.price : '—'}</dd>
          {oblast && <dd className="text-muted">{oblast.note}</dd>}
        </div>
        <div>
          <dt className="text-muted">{t('regionalPrices.country')}</dt>
          <dd className="font-semibold text-primary">{row.countryPrice != null ? formatMoney(row.countryPrice) : '—'}</dd>
        </div>
      </dl>
    </li>
  );
}

function regionLabel(r: Region, t: (k: string, o?: Record<string, unknown>) => string): string {
  return r === 'KYIV_CITY' ? t('regions.KYIV_CITY') : t('priceHint.oblast', { name: t(`regions.${r}`) });
}

/** 1.12 → «+12 %», 0.9 → «−10 %», 1.0 → «0 %». */
export function percentVsCountry(factor: number): string {
  const p = Math.round((factor - 1) * 100);
  return p > 0 ? `+${p} %` : p < 0 ? `−${Math.abs(p)} %` : '0 %';
}
