import type { ReactNode } from 'react';

/** Teaching empty state: round icon + title + hint + optional action. */
export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-brand-soft text-4xl">
        {icon}
      </div>
      <h3 className="mb-2 text-lg font-bold text-primary">{title}</h3>
      {text && <p className="mb-5 max-w-[260px] text-sm leading-relaxed text-muted">{text}</p>}
      {action}
    </div>
  );
}
