import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

type MetricTone = 'brand' | 'amber' | 'green';

const toneStyles: Record<MetricTone, string> = {
  brand: 'bg-brand-soft text-brand',
  amber: 'bg-amber-soft text-amber',
  green: 'bg-success-soft text-success',
};

/** Clickable dashboard metric: label + icon, big value, small hint. */
export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  onClick,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: ReactNode;
  tone?: MetricTone;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-card border border-border bg-surface p-3.5 text-left shadow-card transition-transform active:scale-[0.98] lg:p-[18px]',
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between lg:mb-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted lg:text-xs">
          {label}
        </span>
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-[10px] text-sm lg:h-8 lg:w-8 lg:text-base',
            toneStyles[tone],
          )}
        >
          {icon}
        </span>
      </div>
      <div className="text-3xl font-extrabold leading-none tracking-tight text-primary lg:text-[34px]">
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted lg:text-xs">{hint}</div>}
    </button>
  );
}
