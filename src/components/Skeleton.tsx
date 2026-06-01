import { cn } from '@/lib/cn.ts';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-sunken', className)} />;
}
