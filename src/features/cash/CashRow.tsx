import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format.ts';
import type { CashEntryResponse } from '@/api/types.ts';

/**
 * One line of money — the same row in «Мої гроші» and in «Гроші обʼєкта», so the two screens can
 * never draw one payment two ways. What it was, where it came from, how much. 56 px because it is
 * tapped with a thumb.
 *
 * <p>The client's material money (`clientMaterial`) carries NO sign: it is neither his income nor
 * his spending, and a «−4 300» under «Витрачено 0» reads as the arithmetic slipping. It says whose
 * it is instead — «клієнт поверне» on the receipt, «на матеріал» on the money.</p>
 */
export function CashRow({ entry, onOpen, hideProject = false }: {
  entry: CashEntryResponse;
  onOpen: () => void;
  /** On the object's own card every row is that object — naming it again is noise. */
  hideProject?: boolean;
}) {
  const { t } = useTranslation();
  const income = entry.direction === 'INCOME';
  const client = entry.clientMaterial === true;
  const label = entry.note?.trim()
    || (entry.category ? t('cashCategory.' + entry.category) : t(income ? 'cash.income' : 'cash.expense'));
  // Part of an act's purchase was paid with the client's «на матеріал» money: the row's figure is
  // his own share, and the paper's total is said beside it.
  const share = entry.clientShare ?? 0;
  const details = [
    hideProject ? null : (entry.projectName ?? t('cash.noObject')),
    client ? t(income ? 'cash.clientMaterialIn' : 'cash.clientMaterialOut') : null,
    share > 0
      ? t('cash.clientShare', { total: formatMoney(entry.amount + share), share: formatMoney(share) })
      : null,
    entry.readOnly ? t('cash.lockedBadge') : null,
  ].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-primary">
          {entry.hasPhoto && <span aria-label={t('cash.hasPhoto')}>🧾 </span>}
          {label}
        </span>
        {details && <span className="block truncate text-xs text-muted">{details}</span>}
      </span>
      <span
        className={
          'flex-shrink-0 font-mono text-sm font-semibold tabular-nums '
          + (client ? 'text-muted' : income ? 'text-success' : 'text-primary')
        }
      >
        {client ? '' : income ? '+' : '−'}{formatMoney(entry.amount)}
      </span>
    </>
  );
  const className =
    'flex min-h-14 w-full items-center gap-3 border-b border-border px-3.5 py-2 text-left last:border-b-0';
  // A receipt frozen inside a signed act's `doc_hash` cannot be retyped from here — the server
  // answers 409 and it is right to. So the row is still SHOWN (the money left his pocket and the
  // month must add up) but carries no tap at all: an affordance that can only fail reads as the
  // app being broken, which is how the master described the ones we used to offer.
  if (entry.readOnly) {
    return <div className={className}>{body}</div>;
  }
  return (
    <button type="button" onClick={onOpen} className={className}>
      {body}
    </button>
  );
}
