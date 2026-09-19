import { useTranslation } from 'react-i18next';
import { useToast, type ToastKind } from '@/hooks/useToast.ts';
import { cn } from '@/lib/cn.ts';

const kindStyles: Record<ToastKind, string> = {
  success: 'bg-green-50 border-green-300 text-green-900',
  error: 'bg-red-50 border-red-300 text-red-900',
  info: 'bg-gray-50 border-gray-300 text-gray-900',
};

/**
 * Stacks live toasts at the bottom of the screen on mobile, top-right
 * on desktop. Auto-dismisses on a timer set by the `toast()` caller.
 *
 * <p>The viewport is `z-[70]` — above every other layer (Modal `z-50`, ActionMenu/InfoPopover
 * `z-[60]/[61]`) — and that is load-bearing rather than cosmetic. This lives inside `#root`, while
 * a modal is portalled into `<body>`, i.e. appended AFTER it; at an equal z-index painting order is
 * decided by DOM position alone, so every modal covered every toast. On a phone the two even share
 * one corner — the toast sits at `bottom-4`, exactly where the bottom sheet is — so a toast raised
 * from inside a sheet was reported to nobody: the master pressed «Зберегти», the sheet sat there,
 * and the refusal (a missing required field, or a server error) was painted underneath it. A new
 * overlay must stay below 70.</p>
 */
export function ToastViewport() {
  const { t } = useTranslation();
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-auto sm:right-4 sm:top-4 sm:items-end">
      {toasts.map((item) => (
        <div
          key={item.id}
          role="status"
          className={cn(
            'pointer-events-auto max-w-md rounded-lg border px-4 py-3 text-sm shadow-sm',
            kindStyles[item.kind],
          )}
        >
          <div className="flex items-start gap-3">
            <p className="flex-1">{item.message}</p>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  dismiss(item.id);
                  item.action?.onClick();
                }}
                className="flex-shrink-0 font-semibold text-current underline underline-offset-2"
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="text-current opacity-60 hover:opacity-100"
              aria-label={t('common.close')}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
