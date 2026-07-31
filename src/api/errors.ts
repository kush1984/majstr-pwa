import axios, { type AxiosError } from 'axios';
import { onlineManager } from '@tanstack/react-query';
import i18n from '@/lib/i18n.ts';
import type { BackendError } from './types.ts';

/**
 * Normalises any thrown thing into a human Ukrainian message + the raw
 * backend payload (when available) so callers can inspect status codes.
 */
export interface AppError {
  message: string;
  status?: number;
  retryAfterSeconds?: number;
  /** Machine-readable backend code, e.g. EMAIL_NOT_VERIFIED. */
  code?: string;
  backend?: BackendError;
}

export function toAppError(err: unknown): AppError {
  if (axios.isAxiosError(err)) {
    return fromAxios(err);
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: i18n.t('errors.unknown') };
}

function fromAxios(err: AxiosError): AppError {
  const data = err.response?.data as Partial<BackendError> | undefined;

  // Backend returned a structured error
  if (data && typeof data.message === 'string') {
    return {
      message: data.message,
      status: data.status ?? err.response?.status,
      retryAfterSeconds: data.retryAfterSeconds,
      code: data.code,
      backend: data as BackendError,
    };
  }

  // Network errors / no response
  if (!err.response) {
    // A request that never got an answer has two causes the master acts on very differently: HIS
    // connection is gone, or the server really is unreachable. One message for both said «Сервер
    // недоступний» to someone standing in a basement with the phone in flight mode, sending him
    // looking for a fault that was not there. useOnlineGuard stops actions that START offline;
    // this covers the signal dropping mid-request, which on a site happens just as often.
    return {
      message: onlineManager.isOnline() ? i18n.t('errors.network') : i18n.t('offline.needConnection'),
      // Machine-readable so a caller with a failure message of its own can tell "the server said
      // no" from "the request never left" — see onPdf, where a generic «Не вдалося сформувати PDF»
      // would otherwise bury the actual reason.
      code: 'NETWORK',
    };
  }

  return {
    message: defaultMessageForStatus(err.response.status),
    status: err.response.status,
  };
}

function defaultMessageForStatus(status: number): string {
  switch (status) {
    case 400: return i18n.t('errors.badRequest');
    case 401: return i18n.t('errors.unauthorized');
    case 403: return i18n.t('errors.forbidden');
    case 404: return i18n.t('errors.notFound');
    case 409: return i18n.t('errors.conflict');
    case 429: return i18n.t('errors.tooManyRequests');
    case 500: return i18n.t('errors.serverError');
    default:  return i18n.t('errors.withStatus', { status });
  }
}
