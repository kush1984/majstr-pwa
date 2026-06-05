/**
 * Centralised Ukrainian labels + status→badge mappings for backend enums.
 * UI strings are Ukrainian; keys mirror the Spring enums verbatim.
 */
import type {
  EstimateStatus,
  ItemType,
  ProjectStatus,
  Trade,
  Unit,
} from '@/api/types.ts';

/** Visual variants the Badge component understands. */
export type BadgeVariant = 'active' | 'pending' | 'draft' | 'done' | 'danger';

export const TRADE_LABEL: Record<Trade, string> = {
  ELECTRICAL: 'Електрика',
  PLUMBING: 'Сантехніка',
  TILING: 'Плитка',
  GENERAL: 'Загальні роботи',
  OTHER: 'Інше',
};

export const TRADE_EMOJI: Record<Trade, string> = {
  ELECTRICAL: '⚡',
  PLUMBING: '🔧',
  TILING: '🛁',
  GENERAL: '🛠️',
  OTHER: '📦',
};

export const UNIT_LABEL: Record<Unit, string> = {
  M2: 'м²',
  M: 'м',
  LINEAR_METER: 'м.п.',
  PIECE: 'шт',
  KG: 'кг',
  HOUR: 'год',
  SET: 'компл.',
};

/** "за м²", "за шт" — used in the catalog row subtitle. */
export function unitPer(unit: Unit): string {
  return `за ${UNIT_LABEL[unit]}`;
}

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  WORK: 'Робота',
  MATERIAL: 'Матеріал',
};

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Чернетка', variant: 'draft' },
  ESTIMATING: { label: 'Кошторис', variant: 'pending' },
  IN_PROGRESS: { label: 'В роботі', variant: 'active' },
  COMPLETED: { label: 'Готово', variant: 'done' },
  CANCELLED: { label: 'Скасовано', variant: 'draft' },
};

export const ESTIMATE_STATUS: Record<EstimateStatus, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Чернетка', variant: 'draft' },
  SENT: { label: 'Очікує підпису', variant: 'pending' },
  SIGNED: { label: 'Підписано', variant: 'active' },
  REJECTED: { label: 'Відхилено', variant: 'danger' },
};
