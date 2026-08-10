/**
 * Status→badge variant mappings for backend enums. Display labels live in i18n
 * (`status.project.*` / `status.estimate.*` / `trades.*` / `units.*` /
 * `itemType.*`); components read the label via `t()` and the variant here.
 * Keys mirror the Spring enums verbatim.
 */
import type {
  EstimateStatus,
  ObjectStage,
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

/** Fixed placeholder icon for EVERY master-invented trade (v1) — deliberately not 🔧
 *  (reads as plumbing) since custom trades cover anything. A per-trade emoji picker is
 *  a future nicety, not this iteration. */
export const CUSTOM_TRADE_EMOJI = '🏷️';

/** Trades a template can be filed under — mirrors the backend CHECK on
 *  `estimate_templates.trade` (METAL is intentionally not among them). */
export const TEMPLATE_TRADES: Trade[] = [
  'ELECTRICAL', 'PLUMBING', 'TILING', 'BUILDER', 'PAINTER',
  'DRYWALL', 'FLOORING', 'DEMOLITION', 'GENERAL', 'OTHER',
];

/** @deprecated Superseded by {@link OBJECT_STAGE_VARIANT} (object-status-unification) — the raw
 *  {@link ProjectStatus} is no longer what the UI shows. Kept only because
 *  `ProjectResponse.status` itself is kept (see its own doc comment for why); nothing renders off
 *  this map anymore. */
export const PROJECT_STATUS_VARIANT: Record<ProjectStatus, BadgeVariant> = {
  DRAFT: 'draft',
  ESTIMATING: 'pending',
  IN_PROGRESS: 'active',
  COMPLETED: 'done',
  CANCELLED: 'draft',
};

/** The ONE object-status badge variant map — card, detail hero, and (indirectly, via the same
 *  labels) the filter chips. See {@link ObjectStage}. */
export const OBJECT_STAGE_VARIANT: Record<ObjectStage, BadgeVariant> = {
  ASSESSMENT: 'draft',
  PENDING_SIGNATURE: 'pending',
  IN_PROGRESS: 'active',
  COMPLETED: 'done',
  CANCELLED: 'danger',
};

export const ESTIMATE_STATUS_VARIANT: Record<EstimateStatus, BadgeVariant> = {
  DRAFT: 'draft',
  SENT: 'pending',
  SIGNED: 'active',
  REJECTED: 'danger',
};
