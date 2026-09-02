import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';

export type AddPositionTab = 'catalog' | 'manual';

/**
 * «З каталогу / Вручну» — the two ways a position is ever added. It was written out twice,
 * byte-for-byte, under two sets of i18n keys that held the same words; one component now, so the
 * two surfaces cannot drift apart the way their pickers did.
 */
export function AddPositionTabs({
  tab,
  onChange,
}: {
  tab: AddPositionTab;
  onChange: (next: AddPositionTab) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex gap-1 rounded-xl bg-surface-sunken p-1">
      {(['catalog', 'manual'] as AddPositionTab[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            'min-h-11 flex-1 rounded-lg py-2 text-sm font-semibold transition-colors',
            tab === key ? 'bg-surface text-primary shadow-card' : 'text-muted',
          )}
        >
          {key === 'catalog' ? t('estimate.fromCatalog') : t('estimate.manual')}
        </button>
      ))}
    </div>
  );
}
