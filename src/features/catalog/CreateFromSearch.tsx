import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';

/** The name key the catalog compares positions by: case, edge and repeated spaces do not matter. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Below this a search is still being typed, not a name — offering «Створити «п»» would be noise. */
const MIN_CREATE_LENGTH = 2;

/**
 * Offer to create the searched name when no position carries EXACTLY that name. A search that
 * found similar positions but not this one is the case it exists for: the master types «плитка на
 * фартух», sees three other tile jobs, and would never think to leave the search for the FAB.
 */
export function shouldOfferCreate(query: string, names: Iterable<string>): boolean {
  const key = nameKey(query);
  if (key.length < MIN_CREATE_LENGTH) return false;
  for (const name of names) {
    if (nameKey(name) === key) return false;
  }
  return true;
}

/**
 * «＋ Додати «…» як нову позицію». `prominent` when the search found nothing at all (it replaces
 * the «нічого не знайдено» line); otherwise a quiet row under the results.
 */
export function CreateFromSearch({
  query,
  prominent,
  onCreate,
}: {
  query: string;
  prominent: boolean;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const name = query.trim();
  if (prominent) {
    return (
      <div className="py-6 text-center">
        <p className="mb-3 text-sm text-muted">{t('catalog.createFromSearch.empty')}</p>
        <Button className="h-auto min-h-11 max-w-full whitespace-normal break-words py-2" onClick={onCreate}>
          ＋ {t('catalog.createFromSearch.cta', { name })}
        </Button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onCreate}
      className="mt-2 w-full break-words rounded-lg border border-dashed border-border px-3 py-3 text-left text-sm font-semibold text-brand active:bg-surface-sunken"
    >
      ＋ {t('catalog.createFromSearch.row', { name })}
    </button>
  );
}
