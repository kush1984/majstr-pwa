import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn.ts';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/** A base (unprefixed) width utility in the caller's classes — `w-28`, not `sm:w-28`. */
export function hasOwnWidth(className: string | undefined): boolean {
  return /(^|\s)w-/.test(className ?? '');
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
        // text-base (16px), not text-sm: iOS Safari force-zooms the whole page on focus of any
        // input/select whose computed font-size is under 16px, and the zoom doesn't reliably
        // reset itself when the field blurs or the modal closes — the master has to pinch back out.
        // A caller's own width wins: `cn` only joins strings, and Tailwind emits `w-full` AFTER
        // `w-16`/`w-28` — so a sized field silently stretched (an act row's quantity squeezed its
        // sum into «0» over «₴»).
        !hasOwnWidth(className) && 'w-full',
        'rounded-lg border bg-white px-3 py-2.5 text-base text-gray-900',
        'placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0',
        invalid
          ? 'border-red-400 focus:ring-red-300'
          : 'border-gray-300 focus:border-brand-500 focus:ring-brand-200',
        className,
      )}
    />
  );
});
