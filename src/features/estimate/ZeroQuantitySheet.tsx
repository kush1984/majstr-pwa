import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import type { EstimateItemResponse, EstimateResponse } from '@/api/types.ts';

/**
 * The lines a client would read as «0 ₴»: a work or a material with no quantity. A «%» line has no
 * quantity of its own, an ADDENDUM is the act's paperwork and a signed estimate can no longer lose
 * lines — none of them is asked about.
 */
export function zeroQuantityLines(est: EstimateResponse): EstimateItemResponse[] {
  if (est.status === 'SIGNED' || est.kind === 'ADDENDUM') return [];
  return est.items.filter((i) => i.unit !== 'PERCENT' && Number(i.quantity) === 0);
}

/**
 * «N позицій без кількості — клієнт побачить їх як 0 ₴», asked before the estimate leaves (share,
 * letter, PDF). Straight out of a bundle every quantity is 0, and a line the master never reached
 * went to the client as a row of zeros. Removing is the existing bulk delete (it queues offline);
 * keeping is a real answer too — some masters price «за домовленістю» on purpose.
 */
export function ZeroQuantitySheet({
  open,
  count,
  removing,
  onRemove,
  onKeep,
  onClose,
}: {
  open: boolean;
  count: number;
  removing: boolean;
  onRemove: () => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={t('estimate.zeroLines.title', { count })}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('estimate.zeroLines.hint')}</p>
        <Button fullWidth className="min-h-[48px]" loading={removing} onClick={onRemove}>
          {t('estimate.zeroLines.remove')}
        </Button>
        <Button fullWidth variant="secondary" className="min-h-[48px]" disabled={removing} onClick={onKeep}>
          {t('estimate.zeroLines.keep')}
        </Button>
      </div>
    </Modal>
  );
}
