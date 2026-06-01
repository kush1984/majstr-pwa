import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

/** Filter chip: active is solid ink, inactive is a muted pill. */
export function Chip({ active = false, className, children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-ink text-white' : 'bg-surface-sunken text-muted hover:bg-border',
        className,
      )}
    >
      {children}
    </button>
  );
}
