import { useMe } from '@/features/auth/useMe.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useResendVerification } from './useEmailVerification.ts';

/**
 * Soft (amber, not red) banner shown at the top of authenticated screens
 * while the user's email isn't verified. Renders nothing when verified — or
 * when the field is absent (backend not deployed yet), so it degrades safely.
 */
export function EmailVerificationBanner() {
  const { data: me } = useMe();
  const resend = useResendVerification();

  if (!me || me.emailVerified !== false) return null;

  const onResend = async () => {
    try {
      await resend.mutateAsync();
      toast.success('Лист надіслано — перевірте пошту');
    } catch (err) {
      const e = toAppError(err);
      toast.error(
        e.status === 429
          ? `Зачекайте${e.retryAfterSeconds ? ` ${e.retryAfterSeconds} с` : ''} перед повторною відправкою`
          : e.message,
      );
    }
  };

  return (
    <div className="mb-4 flex flex-col gap-2.5 rounded-card border border-amber/30 bg-amber-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <span className="text-lg leading-none">✉️</span>
        <div>
          <div className="text-sm font-semibold text-primary">Підтвердіть email</div>
          <div className="text-xs text-muted">
            Ми надіслали лист на {me.email}. Підтвердіть, щоб надсилати кошториси клієнтам.
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onResend}
        disabled={resend.isPending}
        className="shrink-0 self-start rounded-lg bg-surface px-3 py-2 text-xs font-semibold text-primary shadow-card disabled:opacity-60 sm:self-auto"
      >
        Надіслати лист ще раз
      </button>
    </div>
  );
}
