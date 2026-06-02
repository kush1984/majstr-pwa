/**
 * Backend response shapes. Mirror Spring DTOs verbatim so a typo in a
 * field name fails at compile time, not in production.
 */

export type Trade = 'ELECTRICAL' | 'PLUMBING' | 'TILING' | 'GENERAL' | 'OTHER';
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

export type Unit = 'M2' | 'M' | 'PIECE' | 'KG' | 'HOUR' | 'SET';

// ---------------------------------------------------------------------------
// Clients (mirror ClientResponse / ClientRequest)
// ---------------------------------------------------------------------------

export interface ClientResponse {
  id: string;
  fullName: string;
  phone: string;
  address: string | null;
  createdAt: string;
}

export interface ClientRequest {
  fullName: string;
  phone: string;
  address?: string;
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
}

export interface EstimateResponse {
  id: string;
  projectId: string;
  status: EstimateStatus;
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: EstimateItemResponse[];
  worksSubtotal: number;
  materialsSubtotal: number;
  total: number;
}

export interface EstimateCreateRequest {
  validUntil?: string;
  notes?: string;
}

export interface EstimateUpdateRequest {
  status: EstimateStatus;
  validUntil?: string;
  notes?: string;
}

export interface EstimateItemRequest {
  type: ItemType;
  name: string;
  category?: string;
  unit: Unit;
  quantity: number;
  unitPrice: number;
  sortOrder?: number;
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
  type: ItemType;
  unit: Unit;
  defaultPrice: number;
  createdAt: string;
}

export interface CatalogItemRequest {
  name: string;
  category?: string;
  type: ItemType;
  unit: Unit;
  defaultPrice: number;
}

export interface CatalogResetResponse {
  added: number;
}
