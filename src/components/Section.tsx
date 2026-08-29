import type { ReactNode } from 'react';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { cn } from '@/lib/cn.ts';

/**
 * A titled panel: one card per block of a long form, so the blocks read as separate things on a
 * phone instead of one continuous stream of rows (master feedback on the act editor — «додаткові
 * роботи, чеки і аванс воно якось все на купі»).
 *
 * The header carries the block's name, an optional (i), and an optional `aside` — the one figure
 * that says whether the block is worth opening (a receipts total, a line count). `aside` is on the
 * right of the header, NOT in the body, because on a 375px screen the header is what stays legible
 * while the body scrolls past.
 *
 * The body is `bg-surface-sunken` so the white item cards inside it read as contents of the panel;
 * `flush` turns that off for a block that draws its own full-width rows.
 */
export function Section({ title, info, aside, flush, children, className }: {
  title: string;
  info?: string;
  aside?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-4 overflow-hidden rounded-card border border-border bg-surface', className)}>
      <div className="flex items-center gap-1.5 border-b border-border px-3.5 py-2.5">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">{title}</h3>
        {info && <InfoPopover text={info} />}
        {aside != null && <div className="ml-auto text-sm font-semibold text-primary">{aside}</div>}
      </div>
      <div className={cn(flush ? '' : 'bg-surface-sunken', 'p-3')}>{children}</div>
    </section>
  );
}
