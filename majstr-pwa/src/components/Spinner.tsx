import { cn } from '@/lib/cn';

interface SpinnerProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Spinner({ className, size = 'md' }: SpinnerProps) {
  const sizeClass = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5';
  return (
    <span
      role="status"
      aria-label="Завантаження"
      className={cn(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        sizeClass,
        className,
      )}
    />
  );
}
