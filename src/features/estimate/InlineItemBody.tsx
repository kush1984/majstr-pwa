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

/**
 * The inside of an estimate row when it edits in place: name · quantity · unit · price · sum, and
 * «⋯» for everything else (unit, category, measurements, description…), which is the old dialog.
 * A «%» line edits only its percent; its sum is derived, so it is read-only.
 */
export function InlineItemBody({
  item, number, percentText, className, onCommit, onMore,
}: {
  item: EstimateItemResponse;
  number: number;
  /** «від Укладання плитки» — what a «%» line is a percentage OF (the board's own label). */
  percentText: string | null;
  className: string;
  onCommit: InlineCommit;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  // The figure the master typed into the sum, while it is not what price × quantity gives.
  const [typedSum, setTypedSum] = useState<number | null>(null);
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

  return (
    <div className={cn('min-w-0 flex-1 rounded-xl border px-2 py-2', className)}>
      <div className="flex items-start gap-1.5">
        <span className="min-w-[1.35rem] flex-shrink-0 pt-3 text-right text-[13px] tabular-nums text-faint">
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
          className="min-h-[44px] min-w-[44px] flex-shrink-0 rounded-md text-lg text-muted active:bg-surface-sunken"
        >
          ⋯
        </button>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[1.7rem] text-xs text-muted">
        {isPercent ? (
          <>
            {item.quantity < 0 && <span className="text-sm font-semibold text-primary">−</span>}
            <InlineNumberCell
              value={Math.abs(item.quantity)}
              kind="percent"
              ariaLabel={label('percent')}
              className="w-[4.5rem] text-sm text-primary"
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
              className="w-[4.75rem] text-sm text-primary"
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
              className="w-[5.75rem] text-sm text-primary"
              onCommit={(p) => {
                setTypedSum(null);
                onCommit(item, { unitPrice: p }, 'price');
              }}
            />
          </>
        )}
        <span aria-hidden className="ml-auto">=</span>
        {isPercent || noQuantity ? (
          <span className="min-h-[44px] content-center px-2 text-sm font-bold text-primary tabular-nums">
            {noQuantity ? '—' : formatMoney(item.lineTotal)}
          </span>
        ) : (
          <InlineNumberCell
            value={item.lineTotal}
            kind="money"
            ariaLabel={label('sum')}
            display={formatInlineNumber(item.lineTotal, 'money')}
            className="w-[6.5rem] text-sm font-bold text-primary"
            onCommit={commitSum}
          />
        )}
      </div>

      {noQuantity && (
        <p className="mt-1 pl-[1.7rem] text-[12px] text-amber-strong">{t('estimate.inline.quantityFirst')}</p>
      )}
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
