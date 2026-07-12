/**
 * Backend response shapes. Mirror Spring DTOs verbatim so a typo in a
 * field name fails at compile time, not in production.
 */

export type Trade =
  | 'ELECTRICAL'
  | 'PLUMBING'
  | 'TILING'
  | 'BUILDER'
  | 'PAINTER'
  | 'DRYWALL'
  | 'FLOORING'
  | 'DEMOLITION'
  | 'GENERAL'
  | 'OTHER';
export type Plan = 'FREE' | 'PRO' | 'TEAM';
export type Role = 'USER' | 'ADMIN';

export interface UserResponse {
  id: string;
  email: string;
  fullName: string;
  trades: Trade[];
  phone: string;
  companyName: string;
  logoUrl: string | null;
  plan: Plan;
  role: Role;
  emailVerified: boolean;
  createdAt: string;
  /** Null until the master consents / acknowledges — drive the one-time
   *  privacy-consent and client-data prompts. */
  consentedToPrivacyAt: string | null;
  acknowledgedClientDataAt: string | null;
  /** When a billing-granted PRO ends (null = FREE, or admin-granted with no
   *  expiry). Drives the "PRO активний до DD.MM" badge. */
  planExpiresAt: string | null;
  /** Subscription auto-renew state + masked card (never the raw token) for the
   *  profile "Підписка" section. */
  autoRenew: boolean;
  cardMask: string | null;
  /** This master's personal referral code — the invite link is
   *  majstr.pro/?ref=m-<referralCode>. */
  referralCode: string;
}

/** PRO subscription period — the client sends this; the server owns the price. */
export type BillingPeriod = 'MONTH' | 'HALF_YEAR';

/** GET /api/referrals/me — the "Запроси майстра" panel stats. */
export interface ReferralStatsResponse {
  referralCode: string;
  invited: number;
  paid: number;
  monthsEarned: number;
}

/** GET /api/plan/limits — the current user's plan caps (null = unlimited),
 *  used to disable "create" actions before the user starts. */
export interface PlanLimits {
  plan: Plan;
  maxProjects: number | null;
  maxEstimatesPerProject: number | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  user: UserResponse;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  trades: Trade[];
  phone: string;
  companyName: string;
  /** Explicit privacy-policy consent (the registration checkbox). */
  consent: boolean;
  /** First-touch attribution: stored ?ref= value + optional typed promo code.
   *  Both optional; absent → the backend attributes DIRECT. */
  ref?: string;
  promoCode?: string;
}

/** PUT /api/profile (#16). `email` is honoured only while the current email is
 *  unverified; when already verified the backend ignores it (or 409
 *  EMAIL_ALREADY_VERIFIED) and keeps the rest. Returns the updated UserResponse. */
export interface ProfileUpdateRequest {
  fullName: string;
  phone: string;
  companyName: string;
  trades: Trade[];
  email?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

/** GlobalExceptionHandler.ErrorResponse on the backend. */
export interface BackendError {
  timestamp: string;
  status: number;
  error: string;
  message: string;
  path: string;
  retryAfterSeconds?: number;
  /** Machine-readable code the client branches on, e.g. EMAIL_NOT_VERIFIED. */
  code?: string;
}

// ---------------------------------------------------------------------------
// Domain enums (mirror com.majstr.backend.entity.*)
// ---------------------------------------------------------------------------

export type ProjectStatus =
  | 'DRAFT'
  | 'ESTIMATING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export type EstimateStatus = 'DRAFT' | 'SENT' | 'SIGNED' | 'REJECTED';

export type ItemType = 'WORK' | 'MATERIAL';

export type Unit =
  | 'M2'
  | 'M'
  | 'LINEAR_METER'
  | 'PIECE'
  | 'KG'
  | 'HOUR'
  | 'SET'
  | 'M3'
  | 'T'
  | 'POINT'
  | 'PERCENT'
  | 'KM';

// ---------------------------------------------------------------------------
// Clients (mirror ClientResponse / ClientRequest)
// ---------------------------------------------------------------------------

export interface ClientResponse {
  id: string;
  fullName: string;
  phone: string;
  address: string | null;
  email: string | null;
  createdAt: string;
}

export interface ClientRequest {
  fullName: string;
  phone: string;
  address?: string;
  /** Optional — lets the contractor email the estimate to the client. */
  email?: string;
}

// ---------------------------------------------------------------------------
// Projects (mirror ProjectResponse / ProjectRequest)
// ---------------------------------------------------------------------------

export interface ProjectResponse {
  id: string;
  name: string;
  address: string;
  status: ProjectStatus;
  description: string | null;
  clientId: string | null;
  clientFullName: string | null;
  /** Latest estimate's total + status for the project card. Null = no estimate yet. */
  latestEstimateTotal: number | null;
  estimateStatus: EstimateStatus | null;
  /** Count of unread client questions across the project's estimates (Fix F). */
  unreadQuestions: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRequest {
  name: string;
  address: string;
  description?: string;
  clientId?: string;
}

// ---------------------------------------------------------------------------
// Client questions (Fix F). Left by the client on the public portal; the
// contractor reads them on the project screen. Mirrors the contractor-facing
// QuestionResponse (the portal's own ack DTO only returns id + createdAt).
// ---------------------------------------------------------------------------

export interface QuestionResponse {
  id: string;
  message: string;
  authorName: string | null;
  authorPhone: string | null;
  isRead: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard metrics (mirror DashboardMetricsResponse). Counts + sums are
// computed by the backend — the client only displays them.
// ---------------------------------------------------------------------------

export interface DashboardMetrics {
  activeProjects: number;
  pendingEstimates: number;
  completedThisMonth: {
    count: number;
    totalAmount: number;
  };
}

// ---------------------------------------------------------------------------
// Estimates (mirror EstimateSummary / EstimateResponse / item DTOs)
// Money fields are BigDecimal on the backend, serialised as JSON numbers.
// ---------------------------------------------------------------------------

export interface EstimateSummary {
  id: string;
  projectId: string;
  name: string | null;
  status: EstimateStatus;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateItemResponse {
  id: string;
  type: ItemType;
  name: string;
  category: string | null;
  unit: Unit;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
  /** Measurement elements this line's quantity was summed from (empty = none). */
  measurementRefs: string[];
  /** True when the master edited the quantity by hand (drives the overwrite warning). */
  quantityManual: boolean;
}

export interface EstimateResponse {
  id: string;
  projectId: string;
  name: string | null;
  status: EstimateStatus;
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: EstimateItemResponse[];
  worksSubtotal: number;
  materialsSubtotal: number;
  total: number;
  /** Deposit paid up front (завдаток); null/absent = none. */
  depositAmount?: number | null;
  /** total − deposit, clamped at 0 (залишок). Equals total when no deposit. */
  balance: number;
}

export interface EstimateCreateRequest {
  validUntil?: string;
  notes?: string;
  name?: string;
}

export interface EstimateUpdateRequest {
  status: EstimateStatus;
  validUntil?: string;
  notes?: string;
  name?: string;
  /** Deposit (завдаток); null clears it. Balance is computed server-side. */
  depositAmount?: number | null;
}

export interface EstimateItemRequest {
  type: ItemType;
  name: string;
  category?: string;
  unit: Unit;
  quantity: number;
  unitPrice: number;
  sortOrder?: number;
  /** Selected measurement elements. When present and `quantityManual` is false, the
   *  server recomputes `quantity` from these (authoritative, unit-checked). */
  measurementRefs?: string[];
  quantityManual?: boolean;
}

export interface EstimateItemFromCatalogRequest {
  quantity: number;
  sortOrder?: number;
}

export interface ShareLinkResponse {
  id: string;
  token: string;
  url: string;
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
}

// ---------------------------------------------------------------------------
// Catalog (mirror CatalogItemResponse / CatalogItemRequest)
// ---------------------------------------------------------------------------

export interface CatalogItemResponse {
  id: string;
  name: string;
  category: string | null;
  /** Trade this position belongs to (for the catalog filter); null = "Інше". */
  trade: Trade | null;
  type: ItemType;
  unit: Unit;
  defaultPrice: number;
  createdAt: string;
}

export interface CatalogItemRequest {
  name: string;
  category?: string;
  /** Optional — which trade this position belongs to. */
  trade?: Trade | null;
  type: ItemType;
  unit: Unit;
  defaultPrice: number;
}

/** One entry in a batch add-from-catalog request. */
export interface BatchCatalogItemEntry {
  catalogItemId: string;
  quantity: number;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Object economy (PRO) — expenses + real profit. Owner-only, never in the portal.
// ---------------------------------------------------------------------------

export type ExpenseCategory = 'MATERIALS' | 'LABOR' | 'OTHER';

export interface ExpenseResponse {
  id: string;
  amount: number;
  category: ExpenseCategory;
  note: string | null;
  spentAt: string; // ISO date (YYYY-MM-DD)
  createdAt: string;
}

export interface ExpenseRequest {
  amount: number;
  category: ExpenseCategory;
  note?: string | null;
  spentAt?: string | null;
}

export interface ObjectEconomyResponse {
  incomeTotal: number;
  incomeSigned: number;
  expensesTotal: number;
  expensesByCategory: Partial<Record<ExpenseCategory, number>>;
  profit: number;
  profitSigned: number;
}

// ---------------------------------------------------------------------------
// Price-list import (parse → review → commit)
// ---------------------------------------------------------------------------

export type DedupPolicy = 'UPDATE_PRICE' | 'SKIP';

/** Zero-based column indices the parser guessed (any may be null). */
export interface ImportMapping {
  nameCol: number | null;
  priceCol: number | null;
  unitCol: number | null;
}

/** One candidate position from the parse; `issues` (e.g. "unit", "price") flags a
 *  cell that needs the master's attention on the review screen. */
export interface ImportParsedRow {
  gridRow: number;
  name: string;
  unit: Unit | null;
  price: number | null;
  type: ItemType;
  issues: string[];
}

export interface CatalogImportParseResponse {
  /** Raw cell matrix — lets the review screen re-map columns locally, no re-upload. */
  grid: string[][];
  rows: ImportParsedRow[];
  skippedRows: number;
  guessedMapping: ImportMapping;
}

/** A confirmed row; `policy` null = use the batch defaultPolicy when the name exists. */
export interface CatalogImportCommitItem {
  name: string;
  unit: Unit;
  price: number;
  type: ItemType;
  policy: DedupPolicy | null;
}

export interface CatalogImportCommitRequest {
  items: CatalogImportCommitItem[];
  trade: Trade | null;
  defaultPolicy: DedupPolicy;
}

export interface CatalogImportCommitResponse {
  created: number;
  updated: number;
  skipped: number;
}

export interface CatalogResetResponse {
  itemsAdded: number;
}

// ---- object measurements (Заміри) -------------------------------------------

export type MeasurementType = 'SURFACE' | 'PARTITION' | 'LINEAR';

/** Payload shapes (must mirror the backend calculator). */
export interface SurfacePayload {
  segments: { l: number; w: number }[];
  openings: { w: number; h: number; n: number }[];
}
export interface PartitionPayload {
  height: number;
  width: number;
  depth: number;
  faces: { left: boolean; right: boolean; end: boolean; top: boolean };
}
export interface LinearPayload {
  height: number;
  width: number;
  sides: { left: boolean; right: boolean; top: boolean; bottom: boolean };
  qty: number;
}
export type MeasurementPayload = SurfacePayload | PartitionPayload | LinearPayload;

export interface MeasurementItem {
  id: string;
  name: string;
  type: MeasurementType;
  unit: Unit;
  /** Computed server-side (m² or м.пог) — the source of truth. */
  result: number;
  /** Raw entered data for re-editing (shape depends on `type`). */
  payload: MeasurementPayload;
  sortOrder: number;
}
export interface MeasurementRoom {
  id: string;
  name: string;
  sortOrder: number;
  items: MeasurementItem[];
  areaTotal: number;
  linearTotal: number;
}
export interface MeasurementsResponse {
  rooms: MeasurementRoom[];
  areaTotal: number;
  linearTotal: number;
}
export interface MeasurementRoomRequest {
  name: string;
  sortOrder?: number;
}
export interface MeasurementItemRequest {
  name: string;
  type: MeasurementType;
  payload: MeasurementPayload;
  sortOrder?: number;
}

// ---- estimate import (LLM: Excel/CSV or photo → a ready estimate) ------------

/** One extracted position from the LLM parse. `issues` (e.g. "unit", "quantity",
 *  "price") flags a value that was unreadable/unrecognized — highlighted for review
 *  (important for hand-written photos). `unit`/`quantity`/`unitPrice` may be null. */
export interface EstimateImportParsedItem {
  name: string;
  unit: Unit | null;
  quantity: number | null;
  unitPrice: number | null;
  type: ItemType;
  category: string | null;
  issues: string[];
}

export interface EstimateImportParseResponse {
  items: EstimateImportParsedItem[];
  /** Deposit (завдаток) the model found on the sheet, or null. */
  depositAmount: number | null;
}

/** A confirmed row for commit. `toCatalog` = also add/keep it in the catalog;
 *  `catalogPolicy` (UPDATE_PRICE/SKIP, null → SKIP) resolves a name conflict there. */
export interface EstimateImportCommitItem {
  name: string;
  unit: Unit;
  quantity: number;
  unitPrice: number;
  type: ItemType;
  category: string | null;
  toCatalog: boolean;
  catalogPolicy: DedupPolicy | null;
}

export interface EstimateImportCommitRequest {
  projectId: string;
  estimateName?: string;
  depositAmount?: number | null;
  items: EstimateImportCommitItem[];
}

export interface EstimateImportCommitResponse {
  estimateId: string;
  total: number;
  catalogCreated: number;
  catalogUpdated: number;
  catalogSkipped: number;
}

/** GET /api/catalog/template-updates — how many NEW default-catalog items
 *  (newer than last synced, my trades, not duplicates) the "Add new from
 *  catalog" button would add. Drives the preview ("Знайдено N нових позицій"). */
export interface TemplateUpdatesResponse {
  available: number;
}

// ---------------------------------------------------------------------------
// Estimate templates — ready-made bundles of works for a typical job.
// `isDefault` separates the 88 system templates from the master's own.
// ---------------------------------------------------------------------------

export interface EstimateTemplateSummary {
  id: string;
  name: string;
  trade: Trade | null;
  isDefault: boolean;
  itemCount: number;
}

export interface EstimateTemplateItemView {
  id: string;
  name: string;
  type: ItemType;
  unit: Unit;
  sortOrder: number;
}

/** Add a position to my own template (no quantity/price). */
export interface TemplateItemRequest {
  name: string;
  type: ItemType;
  unit: Unit;
}

export interface EstimateTemplateDetail {
  id: string;
  name: string;
  trade: Trade | null;
  isDefault: boolean;
  items: EstimateTemplateItemView[];
}

/** Body for "save the current estimate as a template" / rename. */
export interface SaveAsTemplateRequest {
  name: string;
}
