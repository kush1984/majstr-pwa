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
};
