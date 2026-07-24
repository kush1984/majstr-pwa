/**
 * Status→badge variant mappings for backend enums. Display labels live in i18n
 * (`status.project.*` / `status.estimate.*` / `trades.*` / `units.*` /
 * `itemType.*`); components read the label via `t()` and the variant here.
 * Keys mirror the Spring enums verbatim.
 */
import type {
  EstimateStatus,
  ProjectStatus,
  Trade,
} from '@/api/types.ts';

/** Visual variants the Badge component understands. */
export type BadgeVariant = 'active' | 'pending' | 'draft' | 'done' | 'danger';

export const TRADE_EMOJI: Record<Trade, string> = {
  ELECTRICAL: '⚡',
  PLUMBING: '🔧',
  TILING: '🛁',
  BUILDER: '🏗️',
  PAINTER: '🎨',
  DRYWALL: '🧱',
  FLOORING: '🪵',
  DEMOLITION: '🔨',
  METAL: '⚙️',
  GENERAL: '🛠️',
  OTHER: '📦',
};

/** Trades a template can be filed under — mirrors the backend CHECK on
 *  `estimate_templates.trade` (METAL is intentionally not among them). */
export const TEMPLATE_TRADES: Trade[] = [
  'ELECTRICAL', 'PLUMBING', 'TILING', 'BUILDER', 'PAINTER',
  'DRYWALL', 'FLOORING', 'DEMOLITION', 'GENERAL', 'OTHER',
];

export const PROJECT_STATUS_VARIANT: Record<ProjectStatus, BadgeVariant> = {
  DRAFT: 'draft',
  ESTIMATING: 'pending',
  IN_PROGRESS: 'active',
  COMPLETED: 'done',
  CANCELLED: 'draft',
};

export const ESTIMATE_STATUS_VARIANT: Record<EstimateStatus, BadgeVariant> = {
  DRAFT: 'draft',
  SENT: 'pending',
  SIGNED: 'active',
  REJECTED: 'danger',
};
