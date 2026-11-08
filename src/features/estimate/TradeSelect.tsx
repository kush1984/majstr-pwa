import { useTranslation } from 'react-i18next';
import { TEMPLATE_TRADES, TRADE_EMOJI, CUSTOM_TRADE_EMOJI } from '@/lib/labels.ts';
import type { Trade } from '@/api/types.ts';

export interface TradeChoice {
  trade: Trade | null;
  customTradeId: string | null;
}

/**
 * Pick which trade the master's OWN template is filed under. «Загальний» (null) shows it under every
 * trade. Only the trades in his profile are offered, plus his own custom trades — a list of every
 * trade the system has once dropped a bundle under a trade he never picked. The current filing stays
 * in the list even when it is not among them, or the select would silently show another value.
 * A plain native select — one tap on a phone, no custom dropdown to fight.
 */
export function TradeSelect({
  value,
  onChange,
  label,
  trades,
  customTrades = [],
}: {
  value: TradeChoice;
  onChange: (next: TradeChoice) => void;
  label?: string;
  /** The master's profile trades. */
  trades: Trade[];
  customTrades?: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const selectValue = value.customTradeId ? `custom:${value.customTradeId}` : (value.trade ?? 'GENERAL');
  const offered = TEMPLATE_TRADES.filter((tr) => tr === 'GENERAL' || trades.includes(tr) || tr === value.trade);
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
        {offered.map((tr) => (
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
