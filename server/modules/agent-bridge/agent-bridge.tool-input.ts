/**
 * Input readers shared by the Agent Bridge tools.
 *
 * Everything here takes a value straight off the wire and either returns a
 * narrowed, trusted one or throws a named `AgentBridgeValidationError`. Kept
 * apart from the dispatch files so the task tools and the maestro tools check
 * the same field the same way instead of growing two copies that drift.
 */

import type { TaskRow, TaskStage } from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';

import { AgentBridgeTaskNotFoundError, AgentBridgeValidationError } from './agent-bridge.errors.js';
import type { AgentBridgeSessionScope, AgentBridgeToolDeps } from './agent-bridge.types.js';

export const TASK_STAGES: readonly TaskStage[] = ['backlog', 'in_progress', 'review', 'done'];
export const PROVIDERS: readonly LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];
/** Attachment upload is out of scope for the bridge; agents log a file path as a link instead. */
export const AGENT_EVIDENCE_KINDS = ['note', 'link'] as const;
export type AgentEvidenceKind = (typeof AGENT_EVIDENCE_KINDS)[number];

export function readRequiredString(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new AgentBridgeValidationError(`${field} is required.`);
  }
  return text;
}

export function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new AgentBridgeValidationError(`${field} must be a string.`);
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

export function readStage(value: unknown, field: string): TaskStage {
  const stage = readRequiredString(value, field);
  if (!TASK_STAGES.includes(stage as TaskStage)) {
    throw new AgentBridgeValidationError(`${field} must be one of: ${TASK_STAGES.join(', ')}`);
  }
  return stage as TaskStage;
}

export function readEvidenceKind(value: unknown, field: string): AgentEvidenceKind {
  const kind = readRequiredString(value, field);
  if (!AGENT_EVIDENCE_KINDS.includes(kind as AgentEvidenceKind)) {
    throw new AgentBridgeValidationError(`${field} must be one of: ${AGENT_EVIDENCE_KINDS.join(', ')}`);
  }
  return kind as AgentEvidenceKind;
}

export function readOptionalProvider(value: unknown): LLMProvider | undefined {
  const provider = readOptionalString(value, 'provider');
  if (provider === undefined) {
    return undefined;
  }
  if (!PROVIDERS.includes(provider as LLMProvider)) {
    throw new AgentBridgeValidationError(`provider must be one of: ${PROVIDERS.join(', ')}`);
  }
  return provider as LLMProvider;
}

/**
 * Resolves a task id inside the caller's project.
 *
 * The board is listed per project, so this doubles as the authorization check
 * that keeps one session's token from moving or assigning another project's
 * tasks: an id outside the scope is reported as "not found".
 */
export function requireTaskInScope(
  deps: AgentBridgeToolDeps,
  scope: AgentBridgeSessionScope,
  taskId: string,
): TaskRow {
  const task = deps.tasks.listTasks(scope.projectName).find((row) => row.id === taskId);
  if (!task) {
    throw new AgentBridgeTaskNotFoundError(taskId);
  }
  return task;
}
