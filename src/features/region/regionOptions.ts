import type { TFunction } from 'i18next';
import { REGIONS, type Region } from '@/api/types.ts';

/** The regions as a picker lists them: Kyiv city first (the most masters), then the oblasts A–Я. */
export function regionOptions(t: TFunction): { value: Region; label: string }[] {
  const labelled = REGIONS.map((value) => ({ value, label: t(`regions.${value}`) }));
  const city = labelled.filter((o) => o.value === 'KYIV_CITY');
  const rest = labelled.filter((o) => o.value !== 'KYIV_CITY').sort((a, b) => a.label.localeCompare(b.label, 'uk'));
  return [...city, ...rest];
}
