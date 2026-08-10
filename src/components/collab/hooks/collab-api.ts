// Transport helpers shared by the collaboration hooks: they unwrap the
// `{success, data}` envelope so every caller deals with plain data or an Error,
// never with a half-parsed response.

import { authenticatedFetch } from '../../../utils/api';

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: { message?: string } | string;
};

const getApiErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const error = (payload as Record<string, unknown>).error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
};

/** Normalizes a thrown value into a user-facing message. */
export const toMessage = (error: unknown, fallback: string): string =>
  (error instanceof Error && error.message ? error.message : fallback);

/** Performs an authenticated request and returns the unwrapped `data` payload. */
export async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  fallback: string,
): Promise<T> {
  const response = await authenticatedFetch(url, init);

  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // Non-JSON body (proxy error page, empty response): the status text is
    // useless to the user, so surface the caller's fallback instead.
    throw new Error(fallback);
  }

  if (!response.ok || !body.success || !body.data) {
    throw new Error(getApiErrorMessage(body, fallback));
  }

  return body.data;
}

export const collabUrl = (id: string, suffix = ''): string =>
  `/api/collaborations/${encodeURIComponent(id)}${suffix}`;
