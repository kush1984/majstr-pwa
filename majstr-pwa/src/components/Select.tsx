import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      {...rest}
      className={cn(
        'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-gray-900',
        'focus:outline-none focus:ring-2 focus:ring-offset-0',
        invalid
          ? 'border-red-400 focus:ring-red-300'
          : 'border-gray-300 focus:border-brand-500 focus:ring-brand-200',
        className,
      )}
    >
      {children}
    </select>
  );
});
