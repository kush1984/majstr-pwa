import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn.ts';

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

/**
 * A single labelled checkbox styled as a tappable card. Used for the
 * multi-select trade picker on registration. The whole card is the
 * `<label>`, so tapping anywhere toggles the box — friendlier on mobile
 * than a tiny native checkbox.
 *
 * For react-hook-form array fields, spread the same `register('name')`
 * onto several of these with different `value`s; RHF collects the
 * checked values into an array.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, ...rest },
  ref,
) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-gray-900',
        'border-gray-300 bg-white hover:bg-gray-50',
        'has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50',
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-300',
          className,
        )}
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
});
