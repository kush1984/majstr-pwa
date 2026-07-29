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
  /** When the one-time self-serve PRO trial was activated (null = never used).
   *  The "try PRO free" button shows only when this is null and plan is FREE. */
  trialStartedAt: string | null;
  /** This master's personal referral code — the invite link is
   *  majstr.pro/?ref=m-<referralCode>. */
  referralCode: string;
}

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
  /** Whether this estimate counts toward the object's economy (income). */
  countInEconomy: boolean;
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

export interface ObjectEconomyResponse {
  /** Works (labour) subtotal of counted estimates — the master's earnings base. */
  works: number;
  /** Materials subtotal of counted estimates — passthrough, reference only. */
  materials: number;
  /** Deposits received from the client. */
  received: number;
  /** Real material cost (receipt-logged expenses). */
  spentReceipts: number;
  /** Unforeseen (hand-entered) expenses. */
  spentManual: number;
  /** works − spentManual (+ leftover materials cash once the object is COMPLETED). */
  profit: number;
  /** received − spentReceipts (materials pot); NOT clamped — negative = out of pocket. */
  cashBalance: number;
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
  /** Trade to file it under; null/absent = general (shown under every trade). */
  trade?: Trade | null;
}

/** Re-file a template under a trade; null = general. */
export interface TemplateTradeRequest {
  trade: Trade | null;
}
