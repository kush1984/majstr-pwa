import type { DocKind } from '@/lib/projectDocs.ts';
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
  | 'METAL'
  | 'GENERAL'
  | 'OTHER';
export type Plan = 'FREE' | 'PRO' | 'TEAM';
export type Role = 'USER' | 'ADMIN';

/** A master-invented trade (user_trade) — no reference catalog exists for it. */
export interface UserTradeResponse {
  id: string;
  name: string;
  sortOrder: number;
}

export interface UserResponse {
  id: string;
  email: string;
  fullName: string;
  trades: Trade[];
  /** Master-invented trades — ordered by the master's own arrangement. */
  customTrades: UserTradeResponse[];
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
  /** When the one-time self-serve PRO trial was activated (null = never used).
   *  The "try PRO free" button shows only when this is null and plan is FREE. */
  trialStartedAt: string | null;
  /** This master's personal referral code — the invite link is
   *  majstr.pro/?ref=m-<referralCode>. */
  referralCode: string;
  // Document requisites (acts iteration) — all optional; feed the profile form + act PDF.
  legalName: string | null;
  taxId: string | null;
  legalAddress: string | null;
  iban: string | null;
  bankName: string | null;
  vatPayer: boolean;
  vatId: string | null;
  taxGroup: number | null;
  taxRate: number | null;
  docCity: string | null;
  actNumberFormat: ActNumberFormat;
}

/** How a work act's number is displayed — «7» vs «7/2026». */
export type ActNumberFormat = 'PLAIN' | 'WITH_YEAR';

/** The legal nature of a customer — decides which requisites a PDF prints. */
export type ClientType = 'PERSON' | 'FOP' | 'COMPANY';

/** PRO subscription period — the client sends this; the server owns the price. */
export type BillingPeriod = 'MONTH' | 'HALF_YEAR' | 'YEAR';

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
  /** Objects the master has EVER created (lifetime, never decremented on delete) — the basis of the
   *  FREE object cap, so deleting can't slip past it. Compare this, not the live object count. */
  projectsUsed: number;
  maxEstimatesPerProject: number | null;
  /** Progress photos per object (null = unlimited). */
  maxPhotosPerObject: number | null;
  /** Receipt photos per object — a separate budget (null = unlimited). */
  maxReceiptPhotosPerObject: number | null;
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
  /** May be empty — a master can rely entirely on `customTrades` below. At least one of
   *  the two is required (enforced by the register form and again by the backend). */
  trades: Trade[];
  /** Master-invented trade names to create alongside the account (e.g. "Натяжні стелі") —
   *  the same free-text flow the profile screen offers post-registration. */
  customTrades?: string[];
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
  // Document requisites (acts iteration) — all optional.
  legalName?: string;
  taxId?: string;
  legalAddress?: string;
  iban?: string;
  bankName?: string;
  vatPayer?: boolean;
  vatId?: string;
  taxGroup?: number | null;
  taxRate?: number | null;
  docCity?: string;
  actNumberFormat?: ActNumberFormat;
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

/**
 * The ONE object-status vocabulary the UI shows (object-status-unification) — derived
 * server-side (see backend `ObjectStage.derive`), not stored. Read this everywhere a master-facing
 * "status" is shown; `ProjectResponse.status` (the raw {@link ProjectStatus}) is largely vestigial
 * now — only `CANCELLED` on it still means anything, and `stage` already accounts for that.
 */
export type ObjectStage =
  | 'ASSESSMENT'
  | 'PENDING_SIGNATURE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export type EstimateStatus = 'DRAFT' | 'SENT' | 'SIGNED' | 'REJECTED';

export type ItemType = 'WORK' | 'MATERIAL';

/**
 * What a «%» line is a percentage OF.
 *
 * Three kinds and no more: a percentage of another percentage is deliberately impossible, which is
 * what makes cyclic dependencies unbuildable rather than merely detected. The base picker offers
 * ordinary lines only, and that filter IS the protection.
 */
export type PercentBaseKind = 'MANUAL' | 'POSITION' | 'TOTAL';

/**
 * Every unit, once. `Unit` is derived from this, zod schemas do `z.enum(UNITS)`, and the
 * pickers iterate it — so adding a unit is a one-line change here.
 *
 * It used to be a hand-written union with the same list copied into two zod enums and three
 * `const UNITS: Unit[]` arrays. Adding DAY and FLOOR compiled fine, passed the unit-label
 * check, and then failed CI in three files at once: a widened `Unit` no longer fit the
 * narrower hard-coded enums. Six copies of one list is not a typing problem, it is a
 * single-source-of-truth problem.
 *
 * Order matters — it is the order shown in every unit dropdown.
 */
export const UNITS = [
  'M2', 'M', 'LINEAR_METER', 'PIECE', 'KG', 'HOUR', 'SET',
  'M3', 'T', 'POINT', 'PERCENT', 'KM', 'DAY', 'FLOOR',
] as const;

export type Unit = (typeof UNITS)[number];

// ---------------------------------------------------------------------------
// Clients (mirror ClientResponse / ClientRequest)
// ---------------------------------------------------------------------------

export interface ClientResponse {
  id: string;
  fullName: string;
  phone: string;
  address: string | null;
  email: string | null;
  // Document requisites (acts iteration).
  clientType: ClientType;
  taxId: string | null;
  legalName: string | null;
  legalAddress: string | null;
  signatoryTitle: string | null;
  signatoryName: string | null;
  createdAt: string;
}

export interface ClientRequest {
  fullName: string;
  phone: string;
  address?: string;
  /** Optional — lets the contractor email the estimate to the client. */
  email?: string;
  // Document requisites (acts iteration) — all optional; only meaningful for FOP/COMPANY.
  clientType?: ClientType;
  taxId?: string;
  legalName?: string;
  legalAddress?: string;
  signatoryTitle?: string;
  signatoryName?: string;
}

// ---------------------------------------------------------------------------
// Projects (mirror ProjectResponse / ProjectRequest)
// ---------------------------------------------------------------------------

export interface ProjectResponse {
  id: string;
  name: string;
  address: string;
  status: ProjectStatus;
  stage: ObjectStage;
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
// MessageView (the portal's own ack DTO only returns id + createdAt).
// ---------------------------------------------------------------------------

export interface MessageView {
  id: string;
  message: string;
  authorName: string | null;
  authorPhone: string | null;
  /** Which estimate the client asked about on the portal (null = unnamed). */
  estimateName: string | null;
  isRead: boolean;
  createdAt: string;
  /** Photos and PDFs left with the message, oldest first. Empty, never null. */
  files: MessageFileView[];
}

/**
 * One attachment. There is no URL: the bytes come from the owner-authenticated endpoint, addressed by
 * id, so the client builds the path itself. `name` is the sender's own string — render it as text.
 */
export interface MessageFileView {
  id: string;
  name: string | null;
  /** Sniffed server-side from the bytes, never what the uploader claimed. */
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
  /**
   * When retention will delete this file, or null when it is not due. Opening the file clears it on the
   * server, so a marker that has gone means the file is safe for another six months.
   */
  deleteAfter: string | null;
}

// ---------------------------------------------------------------------------
// Object-level client portal: one link per object, the master picks which
// estimates it shows (PortalShareSheet checkboxes mirror `visible`).
// ---------------------------------------------------------------------------

export interface PortalEstimateFlag {
  id: string;
  name: string | null;
  status: EstimateStatus;
  createdAt: string;
  visible: boolean;
}

export interface PortalStateResponse {
  /** Shareable portal URL; null until the first publish mints the link. */
  url: string | null;
  estimates: PortalEstimateFlag[];
  /** Whether the object-level payments card shows on the portal. Off by default. */
  paymentsVisible: boolean;
}

/**
 * The object's message-form URL — a second, separate link. Never null, unlike the portal's: asking
 * for it mints it, because there is nothing to publish first. The form shows the object's name and
 * the contractor's, and no money at all, which is why it cannot be the portal link.
 */
export interface MessageLinkState {
  url: string;
}

// ---------------------------------------------------------------------------
// Dashboard metrics (mirror DashboardMetricsResponse). Counts + sums are
// computed by the backend — the client only displays them.
// ---------------------------------------------------------------------------

export interface DashboardMetrics {
  activeProjects: number;
  /** Objects in the derived PENDING_SIGNATURE stage — renamed from `pendingEstimates`
   *  (object-status-unification): it counts OBJECTS, not estimates. */
  pendingObjects: number;
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
  /** Whether this estimate counts toward the object's economy (income). */
  countInEconomy: boolean;
  /** Set on a marked-up COPY — the list says only the markup reaches the economy. */
  markupPercent?: number | null;
  /** Set on a marked-up COPY: the estimate it came from. The PARENT is found by looking for its
   *  own id here, which is how its row knows to say the crew prices are not earnings. */
  duplicatedFromId?: string | null;
  /** Set when this estimate was auto-reopened to DRAFT because a duplicate of it got signed while
   *  it was still SIGNED — the id of that duplicate. Drives the "клієнт підписав похідний" banner;
   *  the duplicate's own name is found by looking for its id in this same list. */
  supersededByEstimateId?: string | null;
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
  /**
   * For a `PERCENT` line: what it is a percentage OF. Null on every other line.
   *
   * «%» is not a unit of measure — it is a share of something, and `quantity` holds the percent
   * (10 = 10 %) while this says of what. Without it the row could only say «10 % · 500 ₴/%», which
   * is five hundred hryvnia for one percent.
   */
  percentBaseKind: PercentBaseKind | null;
  /** The line this percentage is measured against (`POSITION`); null otherwise. */
  percentBaseItemId: string | null;
  /** The live link is off — the amount was typed by hand, or the base was deleted. */
  baseDetached: boolean;
  /**
   * Snapshot of what a FROZEN percent line meant before a consolidation froze it — the signed
   * percent, what it was a share of, and the source estimate's name (e.g. `-15% від робіт ·
   * кошторис «Квартира — чорнові»`). Null on every other line, including a detached-but-not-
   * frozen line (a deleted POSITION base) — `baseDetached` alone covers that case.
   */
  baseOriginLabel: string | null;
  /**
   * How much of this line has already been closed by SIGNED work acts (acts iteration). Drives the
   * estimate board's «✓ закрито» / «40 / 136,5» chip + green background. `null` when nothing is
   * closed or the estimate isn't SIGNED — a DRAFT act never contributes (same rule as the running
   * total).
   */
  closedByActs: number | null;
}

/**
 * POST /api/estimates/{id}/duplicate — the бригадир's two-price workflow.
 *
 * @param itemIds which lines get the markup. **Omit for every WORK line** — materials are bought
 *                at cost and passed through, so marking them up by default would inflate the
 *                client's estimate in a way the master never asked for.
 */
export interface EstimateDuplicateRequest {
  name?: string;
  /** The MAGNITUDE of the change, ≥ 0. `discount` decides the sign. */
  markupPercent: number;
  /** false = markup (prices up), true = discount (prices down). */
  discount?: boolean;
  itemIds?: string[];
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
  /** For a consolidated estimate: the ids of its source estimates (empty otherwise). Their
   *  receipts are offered too when building this estimate's PDF. */
  sourceEstimateIds?: string[];
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
}

/**
 * The whole arrangement of an estimate's lines, as dragged. Position is the index in the array and
 * the category travels with each line, so moving a line into another section is one request — see
 * the backend's EstimateItemsOrderRequest for why it is stated in full rather than as a move.
 */
export interface EstimateItemsOrderRequest {
  items: { id: string; category?: string | null }[];
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
  /** For a `PERCENT` line: what it is a percentage OF. Omitted elsewhere. */
  percentBaseKind?: PercentBaseKind | null;
  /** Only with `percentBaseKind: 'POSITION'`, and only an ORDINARY line of the same estimate. */
  percentBaseItemId?: string | null;
}

export interface EstimateItemFromCatalogRequest {
  quantity: number;
  sortOrder?: number;
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
  /** Set only when filed under a master-invented trade — `trade` is then always OTHER.
   *  Denormalized alongside its name (a live FK — always current, no snapshot). */
  customTradeId: string | null;
  customTradeName: string | null;
  type: ItemType;
  unit: Unit;
  defaultPrice: number;
  /**
   * The master's own arrangement (backend V87). Satisfies `Arrangeable`, so the catalog shares the
   * estimate board's drag arithmetic instead of owning a second copy of it.
   */
  sortOrder: number;
  createdAt: string;
  /** Other trades that ALSO recognize this exact (name, type, unit) per the default catalog —
   *  never includes `trade` itself. A master's catalog has one row per (name, type, unit), so a
   *  position two of his trades both ship under identical wording is filed under whichever trade
   *  claimed it first; this is how the OTHER trade's filter chip still finds it. The server
   *  always sends this (empty array when nothing is shared) — optional here only so fixtures/
   *  optimistic objects that predate this field don't all need updating. */
  sharedTrades?: Trade[];
}

export interface CatalogItemRequest {
  name: string;
  category?: string;
  /** Optional — which trade this position belongs to. Ignored (forced to OTHER) when
   *  `customTradeId` is set. */
  trade?: Trade | null;
  /** Optional — a master-invented trade instead of one of the above. */
  customTradeId?: string | null;
  type: ItemType;
  unit: Unit;
  defaultPrice: number;
}

/** One entry in a batch add-from-catalog request. */
export interface BatchCatalogItemEntry {
  catalogItemId: string;
  quantity: number;
  sortOrder?: number;
  /** Client-generated id for the line this entry creates — the batch equivalent of the
   *  `X-Entity-Uuid` header, which cannot carry N ids. Makes a replayed offline batch
   *  idempotent PER LINE instead of duplicating the whole selection. */
  id?: string;
}

// ---------------------------------------------------------------------------
// Object economy (PRO) — expenses + real profit. Owner-only, never in the portal.
// ---------------------------------------------------------------------------

export type ExpenseCategory = 'MATERIALS' | 'LABOR' | 'OTHER';
/** RECEIPT = logged from a receipt import (material cost); MANUAL = hand-entered (unforeseen). */
export type ExpenseSource = 'RECEIPT' | 'MANUAL';

export interface ExpenseResponse {
  id: string;
  amount: number;
  category: ExpenseCategory;
  source: ExpenseSource;
  note: string | null;
  spentAt: string; // ISO date (YYYY-MM-DD)
  createdAt: string;
}

export interface ExpenseRequest {
  amount: number;
  category: ExpenseCategory;
  note?: string | null;
  spentAt?: string | null;
  /** Only the receipt flow sends RECEIPT; a hand-entered expense omits it → MANUAL. */
  source?: ExpenseSource;
}

/** One panel in the economy tab's per-estimate list — every SIGNED estimate, regardless of
 *  `countedInEconomy` (the "act" framing). Flag a panel whose amount is NOT in the summary
 *  below it when `countedInEconomy` is false — never silently. */
export interface SignedEstimatePanelResponse {
  id: string;
  name: string | null;
  works: number;
  materials: number;
  /** «% від кошторису» recap, same split as the app's black summary panel — already folded into
   *  works/materials by type, so `total = works + materials` stays correct without adding these. */
  markup: number;
  discount: number;
  total: number;
  countedInEconomy: boolean;
  signedAt: string;
}

/** PRO-only internals — null on `ObjectEconomyResponse` for FREE. Deliberately two numbers
 *  (economy-rework iteration): profit = contracted(counted) − expenses, no works/materials/cash
 *  split — what the master pays out (crew wages included) is logged as an expense instead. */
export interface ObjectEconomyInternalsResponse {
  expenses: number;
  profit: number;
}

export type ProjectPaymentStatus = 'PLANNED' | 'PARTIAL' | 'RECEIVED' | 'OVERDUE';

/** A PLANNED payment stage. Fact (money actually received) is a separate `PaymentReceiptResponse`
 *  list now (V100, payments PLAN/FACT split) — `received`/`remaining` are computed server-side
 *  from that list, and `receipts` is this stage's own history (possibly several partial ones). */
export interface ProjectPaymentResponse {
  id: string;
  amount: number;
  dueDate: string | null;
  nextStage: string | null;
  purpose: string;
  received: number;
  remaining: number;
  status: ProjectPaymentStatus;
  sortOrder: number;
  receipts: PaymentReceiptResponse[];
}

/** Pure plan — no fact fields. "mark received" is a `PaymentReceiptRequest` now, not a field here. */
export interface ProjectPaymentRequest {
  amount: number;
  dueDate?: string | null;
  nextStage?: string | null;
  purpose: string;
}

/** How to resolve a receipt that overshoots its plan stage's remaining amount. The PWA computes
 *  the overflow itself (it already holds the summary) and shows the choice before submitting. */
export type PaymentOverflowResolution = 'TRANSFER' | 'INCREASE' | 'RESERVE';

/** A received payment ("Отриманий платіж"). `planPaymentId` null = unplanned ("Своє") — then
 *  `label` is the master's own name for it, validated distinct from every plan stage's purpose. */
export interface PaymentReceiptResponse {
  id: string;
  planPaymentId: string | null;
  label: string | null;
  /** Resolved name to show: `label` if set, else the linked stage's purpose, else a fallback. */
  displayLabel: string;
  amount: number;
  receivedAt: string;
}

export interface PaymentReceiptRequest {
  planPaymentId?: string | null;
  label?: string | null;
  amount: number;
  receivedAt: string;
  /** Only meaningful when the amount exceeds the targeted stage's remaining balance. */
  resolution?: PaymentOverflowResolution | null;
}

export interface PaymentReceiptEditRequest {
  amount: number;
  receivedAt: string;
  label?: string | null;
}

/** Moves an over-received stage's surplus onto another stage as a partial receipt — offered when
 *  creating a new plan stage while another one is sitting over-received (RESERVE). */
export interface PaymentSurplusTransferRequest {
  fromPaymentId: string;
  toPaymentId: string;
}

/** The owner's money summary — PRO-only on `ObjectEconomyResponse.payments` (economy-polish
 *  iteration; null for FREE). Distinct from the portal's own payments card, which stays gated
 *  only by the `payments_visible` toggle regardless of plan. */
export interface PaymentsSummaryResponse {
  contractedTotal: number;
  received: number;
  remaining: number;
  payments: ProjectPaymentResponse[];
  /** Receipts with no matching plan stage — their own nodes on the timeline. */
  unplannedReceipts: PaymentReceiptResponse[];
}

export type PaymentSplitPreset = 'FIFTY_FIFTY' | 'THIRTY_FORTY_THIRTY' | 'THIRTY_THIRTY_FORTY' | 'CUSTOM';

export interface PaymentSplitRequest {
  preset: PaymentSplitPreset;
  /** Required (and must sum to 100) only when `preset === 'CUSTOM'`. */
  customPercents?: number[];
}

export interface PaymentSplitRow {
  purpose: string;
  amount: number;
}

export interface PaymentSplitPreviewResponse {
  contractedTotal: number;
  rows: PaymentSplitRow[];
}

/** The works axis (acts iteration) — FREE-visible, like `estimates`. How much of the contract the
 *  client has accepted via SIGNED acts, next to how much money has come in. The balance line
 *  (`acceptedByActs − received`) is derived in the PWA: < 0 → «Невідпрацьований аванс», > 0 →
 *  «Заборгованість замовника», 0 → «Розрахунки збігаються». */
export interface ObjectEconomyActsResponse {
  contracted: number;
  acceptedByActs: number;
  received: number;
}

export interface ObjectEconomyResponse {
  /** Every SIGNED estimate of the object — FREE + PRO, always present. */
  estimates: SignedEstimatePanelResponse[];
  /** Contracted / accepted-by-acts / received — FREE + PRO, always present (acts iteration). */
  acts: ObjectEconomyActsResponse;
  /** Contracted/received/remaining + the payment schedule. PRO only as of the economy-polish
   *  iteration — null for FREE, gated together with `internals` behind one lock teaser. */
  payments: PaymentsSummaryResponse | null;
  /** Profit/cash/expenses — PRO only; null for FREE (render the lock teaser). */
  internals: ObjectEconomyInternalsResponse | null;
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

export type MeasurementType =
  | 'SURFACE'
  | 'PARTITION'
  | 'LINEAR'
  /** Electrical points off a plan (шт). */
  | 'ELECTRICAL_POINTS'
  /** Chase length (м.пог) — WORK. Deterministic: bus (if chased) + flagged drops. */
  | 'SHTROBA'
  /** Cable length (м) — MATERIAL. Deterministic: bus + every drop + reserve %. */
  | 'CABLE';

/** Payload shapes (must mirror the backend calculator). */
/**
 * A surface is Σ planes − Σ openings. Each plane is a shape + its dimensions; the
 * unit is chosen once for the whole element and applies to planes and openings alike.
 * Pre-shapes rows are bare `{l, w}` rectangles with no unit — the backend reads a
 * shape-less segment as a rectangle and a missing unit as metres, so there's no
 * migration and old measurements keep their numbers.
 */
export interface SurfaceSegment {
  /** Legacy rectangle sides, in metres. Present only on rows written before shapes. */
  l?: number;
  w?: number;
  shape?: 'rect' | 'lshape' | 'trap' | 'attic' | 'tri' | 'cut' | 'direct';
  mode?: string;
  values?: Record<string, number>;
}
export interface SurfacePayload {
  /** Length unit of every dimension below. Absent = metres (pre-shapes payloads). */
  unit?: 'MM' | 'CM' | 'M';
  segments: SurfaceSegment[];
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
  /** 'length' = a plain running length (result = width × qty), for a skirting run or an
   *  imported reveal total — no reveal-side toggles. Absent = the reveal-sides formula. */
  mode?: 'length';
}
/** Electrical points counted off a plan, grouped by the legend's own wording. */
export interface PointsPayload {
  points: { type: string; count: number; heights: number[]; note?: string | null }[];
}
/**
 * Chase/cable input. ONE payload drives BOTH results (кабель = material, штроба = work),
 * so a `SHTROBA` and a `CABLE` item share this shape. All lengths in MILLIMETRES — that's
 * how plans annotate (h=300 socket, h=900 switch, h=2600 A/C outlet).
 *
 * - CABLE  = busLength + Σ every drop, then × (1 + reserve%). The wire reaches every point.
 * - SHTROBA (chase) = (busLength if busChase) + Σ drops whose point has `chase` — only what
 *   is actually cut. A ceiling bus or an un-plastered wall is left unflagged. No reserve.
 */
export interface ShtrobaPayload {
  /** Height of the horizontal bus above the finished floor. */
  busLevel: number;
  /** true = bus along the top (level = busLevel); false = along the floor (level 0). Per room. */
  busFromTop: boolean;
  /** Explicit length of the horizontal bus (магістраль), mm — set by the master, never guessed. */
  busLength: number;
  /** Whether the bus itself is chased (false when it runs along the ceiling). */
  busChase: boolean;
  /** Slack added to the CABLE only (a chase is cut to size). */
  reservePct: number;
  points: {
    kind: string;
    name?: string;
    h: number;
    qty: number;
    /** Whether THIS drop is chased (false for an un-plastered wall). */
    chase: boolean;
  }[];
}
export type MeasurementPayload =
  | SurfacePayload
  | PartitionPayload
  | LinearPayload
  | PointsPayload
  | ShtrobaPayload;

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
  /** Free-text floor label («1», «цоколь»); null = ungrouped. */
  floor: string | null;
  sortOrder: number;
  items: MeasurementItem[];
  areaTotal: number;
  linearTotal: number;
  /** Electrical points (шт) — kept out of the area figure. */
  pieceTotal: number;
}
export interface MeasurementsResponse {
  rooms: MeasurementRoom[];
  areaTotal: number;
  linearTotal: number;
  pieceTotal: number;
}

/** One point type read off a plan (LLM) — a draft to review, nothing persisted yet. */
export interface ElectricalPlanPoint {
  type: string;
  count: number;
  /** h= annotations, millimetres. */
  heights: number[];
  confidence: Confidence;
  note: string | null;
}
/**
 * A FLAT list of point types (variant 2) — the model only counts symbols and reads printed
 * heights; it does NOT group by room or read room sizes. The master distributes the points
 * across rooms himself in the calculator, where lengths are computed deterministically.
 */
export interface ElectricalPlanParseResponse {
  points: ElectricalPlanPoint[];
  /** LED strip is drawn as lines — flagged only, its length is never LLM-estimated. */
  ledStripPresent: boolean;
  warnings: string[];
}
export interface MeasurementRoomRequest {
  name: string;
  floor?: string | null;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Project-documentation import (designer's PDFs/photos → rooms with a package
// of measurements). Mirrors ProjectImportParseResponse / -CommitRequest.
// ---------------------------------------------------------------------------

export interface ProjectImportOpening {
  kind: string;
  wMm: number;
  hMm: number;
  sillMm: number | null;
  /** Reaches the floor (doors, open passages, panoramic windows) → interrupts the skirting. */
  toFloor?: boolean;
  note: string | null;
}

export interface ProjectImportRoom {
  number: string | null;
  name: string | null;
  areaM2: number | null;
  perimeterMm: number | null;
  wallSegmentsMm: number[] | null;
  /** Overall gabarits off the dimension chains, mm — trusted only after the checksum. */
  widthMm: number | null;
  lengthMm: number | null;
  /** L-shaped room: the cut-out corner, mm (null = not applicable / not read). */
  cutWidthMm: number | null;
  cutDepthMm: number | null;
  /** Per-room ceiling height from the plan's printed «H=…мм» (never Нпр/Нпд). */
  ceilingHmm: number | null;
  openings: ProjectImportOpening[];
  confidence: Confidence;
  note: string | null;
  /**
   * Field names on THIS room whose figures were read but not confirmed — `["widthMm"]`. The value
   * is present and usable; the review screen marks it «перепровірити». Optional so a response from
   * a server that predates the field deserializes as undefined rather than breaking the review.
   */
  uncertain?: string[];
}

export interface ProjectImportFloor {
  floor: string | null;
  /** Room numbers actually MARKED on this sheet — the only reliable floor signal when
   *  the schedule table is printed identically on every floor's sheet. */
  roomsOnThisSheet: string[];
  rooms: ProjectImportRoom[];
}

export interface ProjectImportCovering {
  name: string;
  kind: string | null;
  qty: number;
  unit: 'M2' | 'LINEAR_METER';
}

export interface ProjectImportParseResponse {
  floors: ProjectImportFloor[];
  coverings: ProjectImportCovering[];
  /** «Загальна площа» from the schedule footer — the cross-check anchor. */
  totalAreaM2: number | null;
  /** Absolute ceiling height per floor label, mm. */
  ceilingHeightsMm: Record<string, number>;
  warnings: string[];
  /** What the SHEET says it is, off its own stamp — our own label was a filename guess. */
  sheetTitle?: string | null;
}

/** One sheet offered for triage — its extracted TEXT, which is where a title block lives. */
export interface ProjectTriageSheet {
  id: string;
  name: string;
  text: string;
}

/**
 * What the model made of one sheet, reading its own title block.
 *
 * This is what decides which sheets are read in detail. It replaced keyword lists, which were
 * derived from the projects we happened to have and never matched a Russian or English title.
 */
export interface ProjectTriageResult {
  id: string;
  title: string | null;
  /** Same names the client-side classifier uses, so it drops straight in. */
  kind: DocKind;
  floor: string | null;
  /** AFTER = the layout that will exist; EXISTING = the one being demolished. */
  version: 'AFTER' | 'EXISTING' | 'UNKNOWN';
  hasRoomTable: boolean;
  hasDimensions: boolean;
  hasOpeningSizes: boolean;
  /** The model's recommendation, not a command — the master still sees and edits the ticks. */
  worthReading: boolean;
  note: string | null;
}

export interface ProjectImportCommitRoom {
  name: string;
  floor: string | null;
  items: MeasurementItemRequest[];
}

export interface ProjectImportCommitRequest {
  rooms: ProjectImportCommitRoom[];
}
export interface MeasurementItemRequest {
  name: string;
  type: MeasurementType;
  payload: MeasurementPayload;
  sortOrder?: number;
}

// ---- sketch import (LLM vision: a hand-drawn room sketch photo → measurements) -

export type Confidence = 'high' | 'medium' | 'low';

/** One recognised element — a DRAFT verified against our redrawn schema before commit.
 *  `result` is null when a size was unreadable (the field is left blank + flagged). */
export interface SketchParseItem {
  type: MeasurementType;
  name: string;
  unit: Unit;
  confidence: Confidence;
  note: string | null;
  payload: MeasurementPayload;
  result: number | null;
}
export interface SketchParseRoom {
  name: string;
  confidence: Confidence;
  items: SketchParseItem[];
}
export interface SketchParseResponse {
  /**
   * What the sheet turned out to BE. A PRINTED_PLAN is not reviewed here: the same files go to the
   * project-import flow, which reconciles each printed area against its gabarits, merges several
   * sheets into one set of rooms and guarantees every room a floor, a ceiling and four walls. This
   * path knows кроки only, so a plan read here loses the printed areas and the walls with them.
   */
  sheetKind: 'HAND_DRAWN' | 'PRINTED_PLAN';
  rooms: SketchParseRoom[];
  /** The unit the sketch's numbers are in — the review's default (a wrong guess is fixable). */
  unitGuess: 'MM' | 'CM' | 'M';
  warnings: string[];
}
export interface SketchCommitRoom {
  name: string;
  items: MeasurementItemRequest[];
}
export interface SketchCommitRequest {
  rooms: SketchCommitRoom[];
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

/**
 * GET /api/catalog/update-notice — the pending "we changed your catalog" notice.
 *
 * Written by a catalog migration that rewrote the master's OWN catalog without them asking (the
 * V82–V84 tiling rebuild was the first). `pending: false` is the normal answer, so this is a 200
 * with a flag rather than a 404.
 */
/** One pending "your catalog was updated" notice. `kind` tells the two shapes apart: 'COUNT'
 *  carries added/removed (positionName/oldPrice/newPrice null); 'PRICE_DRIFT' carries the other
 *  three (added/removed both 0). The endpoint returns a LIST — a master can have several at once. */
export interface CatalogUpdateNoticeResponse {
  id: string;
  kind: 'COUNT' | 'PRICE_DRIFT';
  added: number;
  removed: number;
  positionName: string | null;
  oldPrice: number | null;
  newPrice: number | null;
}

// ---------------------------------------------------------------------------
// Consolidated estimate — fold several of an object's estimates into one.
// ---------------------------------------------------------------------------

export interface EstimateConsolidateRequest {
  name?: string;
  estimateIds: string[];
}

// ---------------------------------------------------------------------------
// Receipt import — add lines to an open estimate from a receipt photo (PRO).
// Reuses EstimateImportParseResponse for the review; commit is lighter (no
// catalog, no deposit).
// ---------------------------------------------------------------------------

export interface ReceiptItemsCommitItem {
  name: string;
  unit: Unit;
  quantity: number;
  unitPrice: number;
  type: ItemType;
  category: string | null;
}

// ---------------------------------------------------------------------------
// Object photos — private receipts + progress photos shareable with the client.
// ---------------------------------------------------------------------------

export type PhotoSource = 'RECEIPT' | 'MANUAL';
export type PhotoVisibility = 'PRIVATE' | 'SHARED';

export interface ProjectPhotoResponse {
  id: string;
  source: PhotoSource;
  visibility: PhotoVisibility;
  caption: string | null;
  estimateId: string | null;
  estimateName: string | null;
  /** Path of the authenticated stream (relative). The client prefixes apiBaseUrl
   *  and sends the bearer token — the storage key is never exposed. */
  fileUrl: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Object notes — free text + optional title/phone a master keeps against an object.
// PRIVATE (never in the portal/PDF/share); no PRO gate. Only `body` is required.
// ---------------------------------------------------------------------------

export interface NoteResponse {
  id: string;
  title: string | null;
  phone: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}
export interface NoteRequest {
  title?: string | null;
  phone?: string | null;
  body: string;
}

// ---------------------------------------------------------------------------
// Estimate templates — ready-made bundles of works for a typical job.
// `isDefault` separates the 88 system templates from the master's own.
// ---------------------------------------------------------------------------

export interface EstimateTemplateSummary {
  id: string;
  name: string;
  trade: Trade | null;
  /** Set only for a master's OWN template filed under a master-invented trade — always
   *  null for a system default. */
  customTradeId: string | null;
  customTradeName: string | null;
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
  customTradeId: string | null;
  customTradeName: string | null;
  isDefault: boolean;
  items: EstimateTemplateItemView[];
}

/** Body for "save the current estimate as a template" / rename. */
export interface SaveAsTemplateRequest {
  name: string;
  /** Trade to file it under; null/absent = general (shown under every trade). */
  trade?: Trade | null;
  /** A master-invented trade instead of one of the above — wins over `trade` when set. */
  customTradeId?: string | null;
}

/** Re-file a template under a trade; null = general. */
export interface TemplateTradeRequest {
  trade: Trade | null;
  /** Only takes effect on the caller's OWN template — ignored when re-filing a system default. */
  customTradeId?: string | null;
}

// ---------------------------------------------------------------------------
// Work acts (Акти виконаних робіт) — mirror WorkAct* backend DTOs (acts iteration)
// ---------------------------------------------------------------------------

export type WorkActKind = 'INTERIM' | 'FINAL';
export type WorkActStatus = 'DRAFT' | 'SENT' | 'SIGNED' | 'REJECTED';

export interface WorkActItemResponse {
  id: string;
  estimateItemId: string | null;
  estimateId: string | null;
  type: ItemType;
  name: string;
  category: string | null;
  unit: Unit;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  cumulativeBefore: number;
  /** cumulativeBefore + quantity > the estimate line's current quantity — the master decides. */
  exceedsEstimate: boolean;
  sortOrder: number;
}

export interface WorkActResponse {
  id: string;
  projectId: string;
  number: string;
  kind: WorkActKind;
  status: WorkActStatus;
  issuedAt: string;
  periodFrom: string;
  periodTo: string;
  place: string | null;
  contractRef: string | null;
  note: string | null;
  showMaterials: boolean;
  showCumulative: boolean;
  advanceOffset: number | null;
  retentionPercent: number | null;
  sentAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  signedOffline: boolean;
  addendumEstimateId: string | null;
  items: WorkActItemResponse[];
  total: number;
  payable: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkActCreateRequest {
  kind: WorkActKind;
  issuedAt: string;
  periodFrom: string;
  periodTo: string;
  place?: string | null;
  contractRef?: string | null;
  note?: string | null;
  showMaterials?: boolean;
  showCumulative?: boolean;
  advanceOffset?: number | null;
}

export type WorkActUpdateRequest = WorkActCreateRequest;

export interface WorkActItemLine {
  estimateItemId: string | null;
  estimateId: string | null;
  type: ItemType;
  name: string;
  category?: string | null;
  unit: Unit;
  unitPrice: number;
  quantity: number;
}

export interface WorkActItemsRequest {
  items: WorkActItemLine[];
}

export interface WorkActSignOfflineRequest {
  signerName: string;
}

export interface ActProgressLine {
  estimateId: string;
  estimateName: string | null;
  estimateCreatedAt: string;
  estimateItemId: string;
  type: ItemType;
  name: string;
  category: string | null;
  unit: Unit;
  unitPrice: number;
  estimateQuantity: number;
  done: number;
  remaining: number;
}

export interface ActProgressResponse {
  lines: ActProgressLine[];
}

/** Owner-side state of one act's client share link (acts iteration, prompt 5). One link = one act,
 *  so this is a single URL (null until first publish) + whether the act is currently shared. */
export interface ActShareStateResponse {
  url: string | null;
  shared: boolean;
}
