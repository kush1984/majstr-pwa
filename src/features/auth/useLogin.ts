import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import type { AuthResponse, LoginRequest } from '@/api/types.ts';
import { startSession } from './startSession.ts';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation<AuthResponse, unknown, LoginRequest>({
    mutationFn: authApi.login,
    onSuccess: (data) => startSession(qc, data),
  });
}
