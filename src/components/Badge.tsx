import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';
import type { BadgeVariant } from '@/lib/labels.ts';

const styles: Record<BadgeVariant, string> = {
  active: 'bg-success-soft text-success',
  pending: 'bg-amber-soft text-amber',
  draft: 'bg-surface-sunken text-muted',
  done: 'bg-info-soft text-info',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({
  variant,
  children,
  className,
}: {
  variant: BadgeVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        styles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
