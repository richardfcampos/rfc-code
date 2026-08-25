import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type { AutomationView } from '../types';

const RULE_NAME_PREFIX = 'board-auto-pickup:';
const DEFAULT_MAX_CONCURRENT = 2;
const MIN_MAX_CONCURRENT = 1;
const MAX_MAX_CONCURRENT = 10;

interface AutomationsListResponse {
  success?: boolean;
  data?: { automations?: AutomationView[] };
}

interface AutomationMutationResponse {
  success?: boolean;
  data?: { automation?: AutomationView };
}

async function fetchAutoPickupRule(projectId: string): Promise<AutomationView | null> {
  const response = await authenticatedFetch('/api/automations');
  const body = (await response.json()) as AutomationsListResponse;
  if (!response.ok || !body.success || !Array.isArray(body.data?.automations)) {
    throw new Error('Failed to load automations');
  }
  const ruleName = RULE_NAME_PREFIX + projectId;
  return body.data.automations.find((rule) => rule.name === ruleName) ?? null;
}

function readMaxConcurrent(triggerConfig: Record<string, unknown>): number {
  const value = triggerConfig.maxConcurrent;
  return typeof value === 'number' ? value : DEFAULT_MAX_CONCURRENT;
}

function clampMaxConcurrent(value: number): number | null {
  if (Number.isNaN(value)) {
    return null;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_MAX_CONCURRENT, Math.max(MIN_MAX_CONCURRENT, rounded));
}

/**
 * Finds or creates the single well-known `board-auto-pickup:{projectId}` rule
 * through the existing `/api/automations` REST and keeps the board header
 * toggle/limit in sync with it. Mirrors the fetch + optimistic-mutation shape
 * of `useTaskBoard/useTaskBoardMutations`, minus WS sync (the rule has no
 * broadcast).
 */
export function useAutoPickup(project: Project | null | undefined) {
  const projectId = project?.projectId;
  const fullPath = project?.fullPath;
  const [enabled, setEnabledState] = useState(false);
  const [maxConcurrent, setMaxConcurrentState] = useState(DEFAULT_MAX_CONCURRENT);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const automationIdRef = useRef<string | null>(null);
  // Bumped on every `load()` so a response for a project the user has since
  // switched away from can never overwrite the current one.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    automationIdRef.current = null;
    if (!projectId) {
      setEnabledState(false);
      setMaxConcurrentState(DEFAULT_MAX_CONCURRENT);
      setLoadError(false);
      return;
    }

    const requestSeq = ++requestSeqRef.current;
    setLoadError(false);
    try {
      const rule = await fetchAutoPickupRule(projectId);
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      automationIdRef.current = rule?.automationId ?? null;
      setEnabledState(rule?.enabled ?? false);
      setMaxConcurrentState(rule ? readMaxConcurrent(rule.triggerConfig) : DEFAULT_MAX_CONCURRENT);
    } catch {
      if (requestSeq === requestSeqRef.current) {
        setLoadError(true);
      }
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setEnabled = useCallback(async (next: boolean) => {
    if (!projectId) {
      return;
    }

    const previous = enabled;
    const requestSeq = requestSeqRef.current;
    setEnabledState(next);

    if (!automationIdRef.current) {
      if (!next) {
        // Nothing to disable — no rule exists yet.
        return;
      }
      setIsSaving(true);
      setLoadError(false);
      try {
        const response = await authenticatedFetch('/api/automations', {
          method: 'POST',
          body: JSON.stringify({
            name: RULE_NAME_PREFIX + projectId,
            trigger_kind: 'task_backlog',
            trigger_config: { project: projectId, maxConcurrent },
            action_kind: 'pickup_task',
            action_config: { projectPath: fullPath ?? '' },
            enabled: true,
          }),
        });
        const body = (await response.json()) as AutomationMutationResponse;
        if (!response.ok || !body.success || !body.data?.automation) {
          throw new Error('Failed to create auto-pickup rule');
        }
        automationIdRef.current = body.data.automation.automationId;
      } catch (error) {
        if (requestSeq === requestSeqRef.current) {
          setEnabledState(previous);
          setLoadError(true);
        }
        throw error;
      } finally {
        setIsSaving(false);
      }
      return;
    }

    setIsSaving(true);
    setLoadError(false);
    try {
      const response = await authenticatedFetch(`/api/automations/${encodeURIComponent(automationIdRef.current)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
      const body = (await response.json()) as AutomationMutationResponse;
      if (!response.ok || !body.success || !body.data?.automation) {
        throw new Error('Failed to update auto-pickup rule');
      }
    } catch (error) {
      if (requestSeq === requestSeqRef.current) {
        setEnabledState(previous);
        setLoadError(true);
      }
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [enabled, fullPath, maxConcurrent, projectId]);

  const setMaxConcurrent = useCallback(async (next: number) => {
    const bounded = clampMaxConcurrent(next);
    if (bounded === null || !projectId) {
      return;
    }

    const previous = maxConcurrent;
    const requestSeq = requestSeqRef.current;
    setMaxConcurrentState(bounded);

    if (!automationIdRef.current) {
      // Persisted by the `POST` on first enable — nothing to send yet.
      return;
    }

    setIsSaving(true);
    setLoadError(false);
    try {
      const response = await authenticatedFetch(`/api/automations/${encodeURIComponent(automationIdRef.current)}`, {
        method: 'PATCH',
        // `trigger_config` is re-validated whole server-side — always send the
        // complete object, never just `{ maxConcurrent }`.
        body: JSON.stringify({ trigger_config: { project: projectId, maxConcurrent: bounded } }),
      });
      const body = (await response.json()) as AutomationMutationResponse;
      if (!response.ok || !body.success || !body.data?.automation) {
        throw new Error('Failed to update auto-pickup limit');
      }
    } catch (error) {
      if (requestSeq === requestSeqRef.current) {
        setMaxConcurrentState(previous);
        setLoadError(true);
      }
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [maxConcurrent, projectId]);

  return { enabled, maxConcurrent, isSaving, loadError, setEnabled, setMaxConcurrent };
}
