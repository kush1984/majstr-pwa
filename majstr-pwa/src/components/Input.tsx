import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      {...rest}
      className={cn(
        'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-gray-900',
        'placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0',
        invalid
          ? 'border-red-400 focus:ring-red-300'
          : 'border-gray-300 focus:border-brand-500 focus:ring-brand-200',
        className,
      )}
    />
  );
});
