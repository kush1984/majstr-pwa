import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EstimateItemRequest, EstimateItemResponse } from '@/api/types.ts';
import { InlineNumberCell } from '@/components/InlineNumberCell.tsx';
import { InlineTextCell } from '@/components/InlineTextCell.tsx';
import { formatMoney } from '@/lib/format.ts';
import { formatInlineNumber } from '@/lib/inlineEdit.ts';
import { cn } from '@/lib/cn.ts';
import {
  isManualOverMeasurements, percentPatch, quantityPatch, roundedPrice, sumEdit,
} from './inlineItem.ts';

export type InlineField = 'quantity' | 'price' | 'sum' | 'name' | 'percent';

/** What the editor does with a value typed into a row: save it (through the offline queue) and
 *  offer the undo. */
export type InlineCommit = (item: EstimateItemResponse, patch: Partial<EstimateItemRequest>, field: InlineField) => void;

/** A dot by the line number: this line was just changed (`last`) or changed earlier this session. */
export type RowMarker = 'last' | 'touched' | null;

/**
 * The inside of an estimate row when it edits in place: name · quantity · unit · price · sum, and
 * «⋯» for everything else (unit, category, measurements, description…), which is the old dialog.
 * A «%» line edits only its percent; its sum is derived, so it is read-only.
 *
 * Calm at rest: no card, no frame — the values read as text, the editable numbers carry a dotted
 * underline, and only the open field is framed. A line with no quantity says «к-сть?» where the
 * number goes; the section header counts them.
 */
export function InlineItemBody({
  item, number, percentText, marker = null, className, onCommit, onMore,
}: {
  item: EstimateItemResponse;
  number: number;
  /** «від Укладання плитки» — what a «%» line is a percentage OF (the board's own label). */
  percentText: string | null;
  marker?: RowMarker;
  className?: string;
  onCommit: InlineCommit;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  // The figure the master typed into the sum, while it is not what price × quantity gives.
  const [typedSum, setTypedSum] = useState<number | null>(null);
  // What the quantity or price field reads WHILE it is being typed — the sum follows it live.
  const [draft, setDraft] = useState<{ quantity?: number; price?: number } | null>(null);
  const isPercent = item.unit === 'PERCENT';
  const unit = t('units.' + item.unit);
  const label = (field: string) => `${t('estimate.inline.' + field)}, ${item.name}`;
  const noQuantity = !isPercent && item.quantity === 0;

  const commitSum = (sum: number) => {
    const edit = sumEdit(sum, item.quantity);
    if (edit.kind === 'noQuantity') return;
    setTypedSum(edit.exact ? null : sum);
    onCommit(item, { unitPrice: edit.price }, 'sum');
  };

  const liveSum = draft === null
    ? null
    : (draft.quantity ?? item.quantity) * (draft.price ?? item.unitPrice);
  const draftOf = (field: 'quantity' | 'price') => (v: number | null) =>
    setDraft(v === null ? null : { [field]: v });

  return (
    <div className={cn('min-w-0 flex-1 py-1 pr-1', className)}>
      <div className="flex items-start gap-1">
        <span className="relative min-w-[1.35rem] flex-shrink-0 pt-3 text-right text-[13px] tabular-nums text-faint">
          {marker && (
            <span
              aria-hidden
              data-row-marker={marker}
              className={cn(
                'absolute -left-1.5 top-[1.15rem] h-1.5 w-1.5 rounded-full',
                marker === 'last' ? 'bg-success' : 'bg-brand/50',
              )}
            />
          )}
          {number}.
        </span>
        <InlineTextCell
          value={item.name}
          ariaLabel={label('name')}
          className="min-w-0 flex-1 text-sm font-medium text-primary"
          onCommit={(name) => onCommit(item, { name }, 'name')}
        />
        <button
          type="button"
          onClick={onMore}
          aria-label={t('estimate.inline.more', { name: item.name })}
          className="min-h-[44px] min-w-[40px] flex-shrink-0 text-lg text-faint active:text-muted"
        >
          ⋯
        </button>
      </div>

      <div className="-mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[1.7rem] text-xs text-muted">
        {isPercent ? (
          <>
            {item.quantity < 0 && <span className="text-sm font-semibold text-primary">−</span>}
            <InlineNumberCell
              value={Math.abs(item.quantity)}
              kind="percent"
              ariaLabel={label('percent')}
              className="text-sm font-semibold text-primary"
              onCommit={(pct) => {
                // A percentage of 0 is no line at all — the server refuses it.
                if (pct > 0) onCommit(item, percentPatch(item, pct), 'percent');
              }}
            />
            <span>%</span>
            {percentText && <span className={cn('min-w-0', item.baseDetached && 'text-amber')}>{percentText}</span>}
          </>
        ) : (
          <>
            <InlineNumberCell
              value={item.quantity}
              kind="quantity"
              ariaLabel={label('quantity')}
              className="text-sm font-semibold text-primary"
              display={noQuantity ? t('inline.noQuantity') : undefined}
              tone={noQuantity ? 'warn' : 'default'}
              onDraft={draftOf('quantity')}
              onCommit={(q) => {
                setTypedSum(null);
                onCommit(item, quantityPatch(item, q), 'quantity');
              }}
            />
            <span>{unit}</span>
            {isManualOverMeasurements(item) && (
              <span className="whitespace-nowrap text-[11px] text-amber-strong">{t('estimate.inline.manual')}</span>
            )}
            <span aria-hidden>×</span>
            <InlineNumberCell
              value={item.unitPrice}
              kind="money"
              ariaLabel={label('price')}
              className="text-sm font-semibold text-primary"
              onDraft={draftOf('price')}
              onCommit={(p) => {
                setTypedSum(null);
                onCommit(item, { unitPrice: p }, 'price');
              }}
            />
          </>
        )}
        <span aria-hidden className="ml-auto">=</span>
        {isPercent || (noQuantity && liveSum === null) ? (
          <span className="min-h-[44px] content-center px-1 text-sm font-bold text-primary tabular-nums">
            {noQuantity ? '—' : formatMoney(item.lineTotal)}
          </span>
        ) : (
          // Stays mounted while a neighbour is typed (only its text goes grey), so «Далі» from the
          // price still lands on it.
          <InlineNumberCell
            value={item.lineTotal}
            kind="money"
            ariaLabel={label('sum')}
            display={formatInlineNumber(liveSum ?? item.lineTotal, 'money')}
            tone={liveSum === null ? 'default' : 'dim'}
            className="text-sm font-bold text-primary"
            onCommit={commitSum}
          />
        )}
      </div>

      {typedSum !== null && !noQuantity && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 pl-[1.7rem] text-[12px] text-muted">
          <span>
            {t('estimate.inline.sumActual', {
              typed: formatMoney(typedSum), actual: formatMoney(item.lineTotal),
            })}
          </span>
          <button
            type="button"
            onClick={() => {
              const price = roundedPrice(typedSum, item.quantity);
              setTypedSum(null);
              onCommit(item, { unitPrice: price }, 'price');
            }}
            className="min-h-[44px] font-semibold text-brand underline underline-offset-2"
          >
            {t('estimate.inline.roundPrice')}
          </button>
        </p>
      )}
    </div>
  );
}
