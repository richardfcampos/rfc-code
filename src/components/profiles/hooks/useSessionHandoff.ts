import { useCallback, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

export type HandoffStatus = 'queued' | 'transplanted' | 'seeded';

export interface HandoffResult {
  status: HandoffStatus;
  sessionId: string;
  profileId: string;
  seededSessionId?: string;
}

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: { message?: string } | string;
};

const getApiErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }
  const record = payload as Record<string, unknown>;
  const error = record.error;
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

/**
 * Requests a mid-session account switch (HUB-12). The backend either transplants
 * the session to the target profile, queues the switch until the running turn
 * ends, or degrades to a seeded session — the resolved status is returned so the
 * header can tell the user which happened.
 */
export function useSessionHandoff() {
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HandoffResult | null>(null);

  const switchAccount = useCallback(
    async (sessionId: string, profileId: string): Promise<HandoffResult> => {
      setIsSwitching(true);
      setError(null);
      setResult(null);
      try {
        const response = await authenticatedFetch(
          `/api/profiles/sessions/${encodeURIComponent(sessionId)}/handoff`,
          { method: 'POST', body: JSON.stringify({ profileId }) },
        );
        const body = (await response.json()) as ApiEnvelope<{ handoff: HandoffResult }>;
        if (!response.ok || !body.success || !body.data) {
          throw new Error(getApiErrorMessage(body, 'Failed to switch account'));
        }
        setResult(body.data.handoff);
        return body.data.handoff;
      } catch (switchError) {
        const message = switchError instanceof Error ? switchError.message : 'Failed to switch account';
        setError(message);
        throw switchError;
      } finally {
        setIsSwitching(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setError(null);
    setResult(null);
  }, []);

  return { switchAccount, isSwitching, error, result, reset };
}
