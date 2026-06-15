import i18n from '@/lib/i18n.ts';
import { formatDate } from '@/lib/format.ts';

/**
 * Display name for an estimate: the contractor's own label if set, otherwise a
 * dated default ("Кошторис від 18 листопада") so multiple unnamed variants on a
 * project are still distinguishable in the list.
 */
export function estimateName(name: string | null | undefined, createdAt: string): string {
  const trimmed = name?.trim();
  return trimmed
    ? trimmed
    : i18n.t('estimate.defaultName', { date: formatDate(createdAt) });
}
