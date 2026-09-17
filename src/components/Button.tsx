import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';
import { Spinner } from './Spinner.tsx';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300 focus-visible:ring-brand-500',
  secondary:
    'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 focus-visible:ring-brand-500',
  ghost:
    'bg-transparent text-brand-700 hover:bg-brand-50 disabled:text-gray-400 focus-visible:ring-brand-500',
};

export function Button({
  variant = 'primary',
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        // min-h-11 = 44 px, the floor for a thumb. Padding alone left the button a couple of pixels
        // short of it, which is where a tap starts sliding off the edge of the control.
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed',
        variants[variant],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading && <Spinner size="sm" className="text-current" />}
      {children}
    </button>
  );
}
