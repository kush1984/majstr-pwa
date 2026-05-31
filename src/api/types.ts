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
}
