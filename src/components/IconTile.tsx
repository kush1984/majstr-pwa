import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

export type IconTone = 'brand' | 'amber' | 'blue' | 'green' | 'gray';

const tones: Record<IconTone, string> = {
  brand: 'bg-brand-soft text-brand',
  amber: 'bg-amber-soft text-amber',
  blue: 'bg-info-soft text-info',
  green: 'bg-success-soft text-success',
  gray: 'bg-surface-sunken text-muted',
};

/** Rounded coloured square holding an emoji / glyph. */
export function IconTile({
  tone = 'gray',
  size = 40,
  children,
  className,
}: {
  tone?: IconTone;
  size?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-shrink-0 items-center justify-center rounded-xl', tones[tone], className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {children}
    </div>
  );
}
