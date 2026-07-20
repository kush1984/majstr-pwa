import { api, rawApi } from './client.ts';
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  UserResponse,
} from './types.ts';

/**
 * Auth endpoints. Login + register skip the bearer interceptor (rawApi)
 * because we have nothing to attach yet. /me uses `api` so the
 * Authorization header and refresh interceptor are in play.
 */
export const authApi = {
  register(req: RegisterRequest): Promise<AuthResponse> {
    return rawApi({
      method: 'POST',
      url: '/api/auth/register',
      data: req,
    }).then((r) => r.data as AuthResponse);
  },

  login(req: LoginRequest): Promise<AuthResponse> {
    return rawApi({
      method: 'POST',
      url: '/api/auth/login',
      data: req,
    }).then((r) => r.data as AuthResponse);
  },

  me(): Promise<UserResponse> {
    return api.get<UserResponse>('/api/auth/me').then((r) => r.data);
  },

  /** Revoke the given refresh token server-side. Public endpoint (it identifies
   *  the session from the token in the body, not the bearer), so it goes through
   *  rawApi and works even when the access token has already expired. */
  logout(refreshToken: string): Promise<void> {
    return rawApi({
      method: 'POST',
      url: '/api/auth/logout',
      data: { refreshToken },
    }).then(() => undefined);
  },

  /** Public — the user may open the email link while logged out. Bad/expired
   *  token → 400 (handled by the caller). */
  verifyEmail(token: string): Promise<void> {
    return rawApi({
      method: 'POST',
      url: '/api/auth/verify-email',
      data: { token },
    }).then(() => undefined);
  },

  /** Authenticated — re-send the verification email to the current user.
   *  Rate-limited on the backend (429 with retryAfterSeconds). */
  resendVerification(): Promise<void> {
    return api.post('/api/auth/resend-verification').then(() => undefined);
  },

  /** Public — request a password-reset link. Always resolves (the backend answers a
   *  neutral 200 whether or not the account exists — anti-enumeration). Rate-limited. */
  forgotPassword(email: string): Promise<void> {
    return rawApi({
      method: 'POST',
      url: '/api/auth/forgot',
      data: { email },
    }).then(() => undefined);
  },

  /** Public — set a new password using the token from the reset link. Bad/expired token
   *  → 400 `INVALID_OR_EXPIRED_TOKEN` (handled by the caller). */
  resetPassword(token: string, newPassword: string): Promise<void> {
    return rawApi({
      method: 'POST',
      url: '/api/auth/reset',
      data: { token, newPassword },
    }).then(() => undefined);
  },
};
