import { useTranslation } from 'react-i18next';
import { TEMPLATE_TRADES, TRADE_EMOJI, CUSTOM_TRADE_EMOJI } from '@/lib/labels.ts';
import type { Trade } from '@/api/types.ts';

export interface TradeChoice {
  trade: Trade | null;
  customTradeId: string | null;
}

/**
 * Pick which trade a template is filed under. «Загальна» (null) shows it under every
 * trade. `customTrades` (own templates only — a system default can never carry one)
 * appends the master's own trades below the system list. A plain native select — one
 * tap on a phone, no custom dropdown to fight.
 */
export function TradeSelect({
  value,
  onChange,
  label,
  customTrades = [],
}: {
  value: TradeChoice;
  onChange: (next: TradeChoice) => void;
  label?: string;
  /** Own templates only — omit for a system default (defaults never carry a custom trade). */
  customTrades?: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const selectValue = value.customTradeId ? `custom:${value.customTradeId}` : (value.trade ?? 'GENERAL');
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs text-muted">{label}</span>}
      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          onChange(
            v.startsWith('custom:')
              ? { trade: null, customTradeId: v.slice('custom:'.length) }
              : { trade: v === 'GENERAL' ? null : (v as Trade), customTradeId: null },
          );
        }}
        className="min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-primary"
      >
        {TEMPLATE_TRADES.map((tr) => (
          <option key={tr} value={tr}>
            {TRADE_EMOJI[tr]} {tr === 'GENERAL' ? t('templates.tradeGeneral') : t('trades.' + tr)}
          </option>
        ))}
        {customTrades.map((ct) => (
          <option key={ct.id} value={`custom:${ct.id}`}>
            {CUSTOM_TRADE_EMOJI} {ct.name}
          </option>
        ))}
      </select>
    </label>
  );
}
