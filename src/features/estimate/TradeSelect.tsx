import { useTranslation } from 'react-i18next';
import { TEMPLATE_TRADES, TRADE_EMOJI } from '@/lib/labels.ts';
import type { Trade } from '@/api/types.ts';

/**
 * Pick which trade a template is filed under. «Загальна» (null) shows it under every
 * trade. A plain native select — one tap on a phone, no custom dropdown to fight.
 */
export function TradeSelect({
  value,
  onChange,
  label,
}: {
  value: Trade | null;
  onChange: (trade: Trade | null) => void;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs text-muted">{label}</span>}
      <select
        value={value ?? 'GENERAL'}
        onChange={(e) => onChange(e.target.value === 'GENERAL' ? null : (e.target.value as Trade))}
        className="min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-primary"
      >
        {TEMPLATE_TRADES.map((tr) => (
          <option key={tr} value={tr}>
            {TRADE_EMOJI[tr]} {tr === 'GENERAL' ? t('templates.tradeGeneral') : t('trades.' + tr)}
          </option>
        ))}
      </select>
    </label>
  );
}
