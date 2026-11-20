import { useTranslation } from 'react-i18next';
import { formatDateTime, formatMoney } from '@/lib/format.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { Button } from '@/components/Button.tsx';
import { useProjectMessages, useSettlePaymentNotice } from '@/features/messages/useMessages.ts';
import { MessageAttachments } from '@/features/messages/MessageAttachments.tsx';

/**
 * A client's «Я оплатив» that the receipt check could not settle (V217): no receipt, unreadable, a
 * different sum or recipient. It waits HERE, in the object's money, not in a notification — a master
 * with notifications off still meets it the next time he looks at the money. One that matched was
 * already recorded and is not shown; nothing waits = nothing rendered.
 */
export function PaymentNotices({ objectId, canWrite }: { objectId: string; canWrite: boolean }) {
  const { t } = useTranslation();
  const messages = useProjectMessages(objectId);
  const settle = useSettlePaymentNotice(objectId);
  const waiting = (messages.data ?? []).filter(
    (m) => m.kind === 'PAYMENT' && m.paymentStatus === 'PENDING' && m.paymentAmount != null,
  );
  if (waiting.length === 0) return null;

  const answer = (messageId: string, arrived: boolean) =>
    settle.mutate(
      { messageId, arrived },
      {
        onSuccess: () => toast.success(t(arrived ? 'economy.noticeRecorded' : 'economy.noticeDismissed')),
        onError: (err) => toast.error(toAppError(err).message),
      },
    );

  return (
    <div className="space-y-2">
      {waiting.map((m) => (
        <div key={m.id} className="rounded-card border border-amber/40 bg-amber-soft p-3.5">
          <p className="text-sm font-semibold text-primary">
            {t('economy.noticeTitle', { amount: formatMoney(m.paymentAmount ?? 0) })}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {(m.authorName || t('messages.client')) + ' · ' + formatDateTime(m.createdAt)}
          </p>
          {m.paymentNote && (
            <p className="mt-1.5 text-sm text-secondary">
              {t('economy.noticeUnverified', { reason: m.paymentNote })}
            </p>
          )}
          <MessageAttachments projectId={objectId} messageId={m.id} files={m.files ?? []} />
          {canWrite && (
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <Button
                onClick={() => answer(m.id, true)}
                loading={settle.isPending && settle.variables?.messageId === m.id && settle.variables.arrived}
                disabled={settle.isPending}
              >
                {t('economy.noticeArrived')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => answer(m.id, false)}
                loading={settle.isPending && settle.variables?.messageId === m.id && !settle.variables.arrived}
                disabled={settle.isPending}
              >
                {t('economy.noticeNotArrived')}
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
