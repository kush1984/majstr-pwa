import axios, { type AxiosError } from 'axios';
import type { BackendError } from './types';

/**
 * Normalises any thrown thing into a human Ukrainian message + the raw
 * backend payload (when available) so callers can inspect status codes.
 */
export interface AppError {
  message: string;
  status?: number;
  retryAfterSeconds?: number;
  backend?: BackendError;
}

export function toAppError(err: unknown): AppError {
  if (axios.isAxiosError(err)) {
    return fromAxios(err);
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: 'Невідома помилка' };
}

function fromAxios(err: AxiosError): AppError {
  const data = err.response?.data as Partial<BackendError> | undefined;

  // Backend returned a structured error
  if (data && typeof data.message === 'string') {
    return {
      message: data.message,
      status: data.status ?? err.response?.status,
      retryAfterSeconds: data.retryAfterSeconds,
      backend: data as BackendError,
    };
  }

  // Network errors / no response
  if (!err.response) {
    return {
      message: 'Сервер недоступний. Перевірте з’єднання та повторіть.',
    };
  }

  return {
    message: defaultMessageForStatus(err.response.status),
    status: err.response.status,
  };
}

function defaultMessageForStatus(status: number): string {
  switch (status) {
    case 400: return 'Невірний запит';
    case 401: return 'Невірний логін або пароль';
    case 403: return 'Доступ заборонено';
    case 404: return 'Не знайдено';
    case 409: return 'Конфлікт даних';
    case 429: return 'Забагато спроб. Спробуйте за кілька хвилин.';
    case 500: return 'Помилка сервера';
    default:  return `Помилка ${status}`;
  }
}
