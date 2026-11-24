import type { TFunction } from 'i18next';
import type { ReopenBlock } from '@/api/types.ts';

/**
 * Why «Перевідкрити для змін» cannot happen now, and what to do — said BEFORE the tap (owner,
 * 2026-11-24: «зразу показувати чому воно не можливо або що зробити щоб було можливе»). The
 * reason comes from the server (`ReopenGuard`), the same rule the reopen itself applies.
 */
export function reopenBlockMessage(t: TFunction, block: ReopenBlock): string {
  const acts = block.actNumbers.map((n) => t('estimate.reopenBlock.actNumber', { number: n })).join(', ');
  const count = block.actNumbers.length;
  switch (block.reason) {
    case 'ADDENDUM':
      return t('estimate.reopenBlock.addendum');
    case 'DRAFT_ACT':
      return t('estimate.reopenBlock.draft', { acts, count });
    case 'SENT_ACT':
      return t('estimate.reopenBlock.sent', { acts, count });
    case 'SIGNED_ACT':
      return count > 0 ? t('estimate.reopenBlock.signed', { acts, count }) : t('estimate.reopenBlock.signedNoNumber');
  }
}

/** The master can clear these himself in «Акти» — the notice offers a way there. */
export function reopenBlockFixableInActs(block: ReopenBlock): boolean {
  return block.reason === 'DRAFT_ACT' || block.reason === 'SENT_ACT';
}
