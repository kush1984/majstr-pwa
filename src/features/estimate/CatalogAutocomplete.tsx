import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { useDebouncedValue } from '@/hooks/useDebouncedValue.ts';
import { useCatalog, useCatalogSearch } from '@/features/catalog/useCatalog.ts';
import { formatMoney } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import type { CatalogItemResponse } from '@/api/types.ts';

const MAX_SUGGESTIONS = 10;

/**
 * Type-ahead over the contractor's OWN catalog for the add-item name field.
 * Debounced server search (`useCatalogSearch`) with a graceful client-side
 * fallback over the already-loaded catalog, so it works before the backend
 * `/search` endpoint ships. Picking a suggestion hands the full catalog item
 * back via `onPick` (the form fills name/type/unit/price); no match shows an
 * "add manually" row. Keyboard: ↑/↓ move, Enter picks, Esc closes. Styled with
 * the in-app theme (orange brand) to match the estimate editor.
 */
export function CatalogAutocomplete({
  id,
  value,
  invalid,
  placeholder,
  onChange,
  onBlur,
  onPick,
}: {
  id?: string;
  value: string;
  invalid?: boolean;
  placeholder?: string;
  onChange: (text: string) => void;
  onBlur?: () => void;
  onPick: (item: CatalogItemResponse) => void;
}) {
  const { t } = useTranslation();
  const debounced = useDebouncedValue(value, 250);
  const term = debounced.trim();

  const search = useCatalogSearch(debounced);
  const all = useCatalog(); // shared (cached) full list — the fallback source

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestions = useMemo<CatalogItemResponse[]>(() => {
    if (term.length < 1) return [];
    // Prefer the server result; fall back to filtering the loaded catalog when
    // the endpoint isn't there yet or errored.
    if (search.isSuccess) return search.data.slice(0, MAX_SUGGESTIONS);
    const needle = term.toLowerCase();
    return (all.data ?? [])
      .filter((i) => i.name.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [term, search.isSuccess, search.data, all.data]);

  const loading = term.length >= 1 && search.isFetching && !search.isSuccess && !all.data;
  const exactMatch = suggestions.some(
    (s) => s.name.trim().toLowerCase() === value.trim().toLowerCase(),
  );
  const showAddManual = term.length >= 1 && !exactMatch;
  const rowCount = suggestions.length + (showAddManual ? 1 : 0);

  // Keep the active row in range as the list changes.
  useEffect(() => {
    setActive((a) => (a >= rowCount ? rowCount - 1 : a));
  }, [rowCount]);

  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);

  const pick = (item: CatalogItemResponse) => {
    onPick(item);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, rowCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && active < suggestions.length) {
        e.preventDefault();
        pick(suggestions[active]);
      } else if (open && showAddManual && active === suggestions.length) {
        e.preventDefault();
        setOpen(false); // keep the typed name; the form is already manual
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  };

  const dropdownVisible = open && term.length >= 1;

  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={dropdownVisible}
        aria-autocomplete="list"
        invalid={invalid}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => value.trim() && setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Delay so a click on a suggestion lands before we close.
          blurTimer.current = setTimeout(() => setOpen(false), 150);
          onBlur?.();
        }}
      />

      {dropdownVisible && (
        <ul
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-card-lg"
        >
          {loading && (
            <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted">
              <Spinner size="sm" className="text-brand" /> {t('estimate.acSearching')}
            </li>
          )}

          {!loading &&
            suggestions.map((item, i) => (
              <li key={item.id} role="option" aria-selected={active === i}>
                <button
                  type="button"
                  // onMouseDown (not onClick) so it fires before the input's blur.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(item);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2.5 text-left',
                    active === i ? 'bg-brand-soft' : 'hover:bg-surface-sunken',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium text-primary">
                      {item.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className={cn(
                          'rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
                          item.type === 'WORK'
                            ? 'bg-brand-soft text-brand'
                            : 'bg-info-soft text-info',
                        )}
                      >
                        {t('itemType.' + item.type)}
                      </span>
                      <span className="text-xs text-muted">
                        {formatMoney(item.defaultPrice)}/{t('units.' + item.unit)}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}

          {!loading && showAddManual && (
            <li role="option" aria-selected={active === suggestions.length}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                }}
                onMouseEnter={() => setActive(suggestions.length)}
                className={cn(
                  'flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm',
                  suggestions.length === 0 ? 'border-t-0' : '',
                  active === suggestions.length ? 'bg-brand-soft' : 'hover:bg-surface-sunken',
                )}
              >
                <span className="text-base leading-none text-brand">+</span>
                <span className="text-primary">{t('estimate.acAddManual', { name: value.trim() })}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
