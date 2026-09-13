import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

type NotifyHubView = {
  url: string | null;
  hasToken: boolean;
  tokenHint: string | null;
  timezone: string | null;
  source: 'db' | 'env' | 'none';
  configured: boolean;
};

type NotifyHubConfigResponse = { success?: boolean; config?: NotifyHubView; error?: string };
type NotifyHubTestResponse = { success?: boolean; ok: boolean; status: number | null; error?: string };
type NotifyHubFormState = { url: string; token: string; timezone: string };

const EMPTY_VIEW: NotifyHubView = {
  url: null,
  hasToken: false,
  tokenHint: null,
  timezone: null,
  source: 'none',
  configured: false,
};

const toResponseJson = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
};

export function useNotifyHubSettings() {
  const [view, setView] = useState<NotifyHubView>(EMPTY_VIEW);
  const [form, setForm] = useState<NotifyHubFormState>({ url: '', token: '', timezone: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message?: string } | null>(null);
  const [testResult, setTestResult] = useState<NotifyHubTestResponse | null>(null);

  const applyView = useCallback((nextView: NotifyHubView) => {
    setView(nextView);
    setForm((prev) => ({
      url: nextView.url ?? '',
      token: '',
      timezone: nextView.timezone || prev.timezone || browserTimezone(),
    }));
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const response = await authenticatedFetch('/api/notifications/notify-hub');
      const data = await toResponseJson<NotifyHubConfigResponse>(response);
      if (response.ok && data.config) {
        applyView(data.config);
      } else {
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [applyView]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateForm = useCallback(<K extends keyof NotifyHubFormState>(key: K, value: NotifyHubFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const body: { url: string; token?: string; timezone?: string } = {
        url: form.url.trim(),
        timezone: form.timezone.trim(),
      };
      if (form.token.trim()) {
        body.token = form.token.trim();
      }

      const response = await authenticatedFetch('/api/notifications/notify-hub', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const data = await toResponseJson<NotifyHubConfigResponse>(response);

      if (response.ok && data.config) {
        applyView(data.config);
        setSaveStatus({ type: 'success' });
      } else {
        setSaveStatus({ type: 'error', message: data.error || undefined });
      }
    } catch (error) {
      setSaveStatus({ type: 'error', message: error instanceof Error ? error.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }, [applyView, form.timezone, form.token, form.url]);

  const test = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await authenticatedFetch('/api/notifications/notify-hub/test', {
        method: 'POST',
      });
      const data = await toResponseJson<NotifyHubTestResponse>(response);
      setTestResult(data);
    } catch (error) {
      setTestResult({ ok: false, status: null, error: error instanceof Error ? error.message : 'unknown error' });
    } finally {
      setIsTesting(false);
    }
  }, []);

  return {
    view,
    form,
    updateForm,
    isLoading,
    isSaving,
    isTesting,
    loadFailed,
    saveStatus,
    testResult,
    save,
    test,
  };
}
