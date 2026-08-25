/**
 * Field-level validation for automation rules.
 *
 * Every automation arrives as untrusted JSON and is stored as JSON, so this is
 * the only place that decides what a valid rule looks like. Configs are
 * normalized on the way in (unknown keys dropped, strings trimmed): what the
 * database holds is exactly what the engine will read back.
 */

import type { AutomationActionKind, AutomationTriggerKind, TaskStage } from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';

import { AutomationValidationError } from './automations.errors.js';
import { parseCronExpression } from './services/cron-expression.js';

const TRIGGER_KINDS: AutomationTriggerKind[] = [
  'cron',
  'task_stage',
  'webhook',
  'quota_threshold',
  'task_backlog',
];
const ACTION_KINDS: AutomationActionKind[] = ['prompt_agent', 'create_task', 'notify_push', 'pickup_task'];
const TASK_STAGES: TaskStage[] = ['backlog', 'in_progress', 'review', 'done'];
const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

const MAX_NAME_LENGTH = 200;
const MAX_TEXT_LENGTH = 8000;
const DEFAULT_QUOTA_COOLDOWN_MINUTES = 60;
const DEFAULT_BACKLOG_MAX_CONCURRENT = 2;

export function requireAutomationId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AutomationValidationError('automation_id is required');
  }
  return value.trim();
}

export function validateName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AutomationValidationError('name is required');
  }
  const name = value.trim();
  if (name.length > MAX_NAME_LENGTH) {
    throw new AutomationValidationError(`name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

export function validateEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new AutomationValidationError('enabled must be a boolean');
  }
  return value;
}

export function validateTriggerKind(value: unknown): AutomationTriggerKind {
  if (typeof value !== 'string' || !TRIGGER_KINDS.includes(value as AutomationTriggerKind)) {
    throw new AutomationValidationError(`trigger_kind must be one of: ${TRIGGER_KINDS.join(', ')}`);
  }
  return value as AutomationTriggerKind;
}

export function validateActionKind(value: unknown): AutomationActionKind {
  if (typeof value !== 'string' || !ACTION_KINDS.includes(value as AutomationActionKind)) {
    throw new AutomationValidationError(`action_kind must be one of: ${ACTION_KINDS.join(', ')}`);
  }
  return value as AutomationActionKind;
}

function readConfigObject(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AutomationValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, key: string, field: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AutomationValidationError(`${field}.${key} is required`);
  }
  if (value.length > MAX_TEXT_LENGTH) {
    throw new AutomationValidationError(`${field}.${key} must be at most ${MAX_TEXT_LENGTH} characters`);
  }
  return value.trim();
}

function optionalString(source: Record<string, unknown>, key: string, field: string): string | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new AutomationValidationError(`${field}.${key} must be a string`);
  }
  if (value.length > MAX_TEXT_LENGTH) {
    throw new AutomationValidationError(`${field}.${key} must be at most ${MAX_TEXT_LENGTH} characters`);
  }
  return value.trim();
}

function optionalStage(source: Record<string, unknown>, key: string): TaskStage | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !TASK_STAGES.includes(value as TaskStage)) {
    throw new AutomationValidationError(`trigger_config.${key} must be one of: ${TASK_STAGES.join(', ')}`);
  }
  return value as TaskStage;
}

function requireNumber(
  source: Record<string, unknown>,
  key: string,
  field: string,
  bounds: { min: number; max: number; integer?: boolean },
): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AutomationValidationError(`${field}.${key} must be a number`);
  }
  if (bounds.integer && !Number.isInteger(value)) {
    throw new AutomationValidationError(`${field}.${key} must be an integer`);
  }
  if (value < bounds.min || value > bounds.max) {
    throw new AutomationValidationError(`${field}.${key} must be between ${bounds.min} and ${bounds.max}`);
  }
  return value;
}

/**
 * Validates and normalizes a trigger config for its kind.
 *
 * `previous` carries the stored config of the automation being updated: a
 * webhook's `secretHash` is server-owned and is never read from the request, so
 * updating an unrelated field must not silently drop (or let a caller choose)
 * the credential.
 */
export function validateTriggerConfig(
  kind: AutomationTriggerKind,
  rawConfig: unknown,
  previous: Record<string, unknown> = {},
): Record<string, unknown> {
  const config = readConfigObject(rawConfig, 'trigger_config');

  if (kind === 'cron') {
    const expression = requireString(config, 'cron', 'trigger_config');
    try {
      parseCronExpression(expression);
    } catch (error) {
      throw new AutomationValidationError(
        `trigger_config.cron is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { cron: expression };
  }

  if (kind === 'task_stage') {
    const toStage = optionalStage(config, 'toStage');
    if (!toStage) {
      throw new AutomationValidationError(`trigger_config.toStage must be one of: ${TASK_STAGES.join(', ')}`);
    }
    const normalized: Record<string, unknown> = { toStage };
    const fromStage = optionalStage(config, 'fromStage');
    if (fromStage) normalized.fromStage = fromStage;
    const project = optionalString(config, 'project', 'trigger_config');
    if (project) normalized.project = project;
    return normalized;
  }

  if (kind === 'quota_threshold') {
    const normalized: Record<string, unknown> = {
      profileId: requireString(config, 'profileId', 'trigger_config'),
      thresholdPct: requireNumber(config, 'thresholdPct', 'trigger_config', { min: 1, max: 100 }),
    };
    if (config.cooldownMinutes !== undefined && config.cooldownMinutes !== null) {
      normalized.cooldownMinutes = requireNumber(config, 'cooldownMinutes', 'trigger_config', {
        min: 1,
        max: 60 * 24 * 7,
      });
    } else {
      normalized.cooldownMinutes = DEFAULT_QUOTA_COOLDOWN_MINUTES;
    }
    return normalized;
  }

  if (kind === 'task_backlog') {
    const normalized: Record<string, unknown> = {
      project: requireString(config, 'project', 'trigger_config'),
    };
    if (config.maxConcurrent !== undefined && config.maxConcurrent !== null) {
      normalized.maxConcurrent = requireNumber(config, 'maxConcurrent', 'trigger_config', {
        min: 1,
        max: 10,
        integer: true,
      });
    } else {
      normalized.maxConcurrent = DEFAULT_BACKLOG_MAX_CONCURRENT;
    }
    return normalized;
  }

  // webhook: the only field is the credential digest, which the service owns.
  return typeof previous.secretHash === 'string' ? { secretHash: previous.secretHash } : {};
}

/** Validates and normalizes an action config for its kind. */
export function validateActionConfig(
  kind: AutomationActionKind,
  rawConfig: unknown,
): Record<string, unknown> {
  const config = readConfigObject(rawConfig, 'action_config');

  if (kind === 'prompt_agent') {
    const normalized: Record<string, unknown> = {
      projectPath: requireString(config, 'projectPath', 'action_config'),
      promptTemplate: requireString(config, 'promptTemplate', 'action_config'),
    };

    const provider = optionalString(config, 'provider', 'action_config');
    if (provider) {
      if (!PROVIDERS.includes(provider as LLMProvider)) {
        throw new AutomationValidationError(`action_config.provider must be one of: ${PROVIDERS.join(', ')}`);
      }
      normalized.provider = provider;
    }

    for (const key of ['profileId', 'skill', 'worktreePath', 'worktreeBranch'] as const) {
      const value = optionalString(config, key, 'action_config');
      if (value) normalized[key] = value;
    }
    return normalized;
  }

  if (kind === 'create_task') {
    const normalized: Record<string, unknown> = {
      project: requireString(config, 'project', 'action_config'),
      title: requireString(config, 'title', 'action_config'),
    };
    for (const key of ['description', 'suggestedSkill', 'assigneeProfileId'] as const) {
      const value = optionalString(config, key, 'action_config');
      if (value) normalized[key] = value;
    }
    return normalized;
  }

  if (kind === 'pickup_task') {
    const normalized: Record<string, unknown> = {
      projectPath: requireString(config, 'projectPath', 'action_config'),
    };

    const provider = optionalString(config, 'provider', 'action_config');
    if (provider) {
      if (!PROVIDERS.includes(provider as LLMProvider)) {
        throw new AutomationValidationError(`action_config.provider must be one of: ${PROVIDERS.join(', ')}`);
      }
      normalized.provider = provider;
    }

    for (const key of ['profileId', 'baseBranch'] as const) {
      const value = optionalString(config, key, 'action_config');
      if (value) normalized[key] = value;
    }
    return normalized;
  }

  const normalized: Record<string, unknown> = {
    message: requireString(config, 'message', 'action_config'),
  };
  if (config.userId !== undefined && config.userId !== null) {
    normalized.userId = requireNumber(config, 'userId', 'action_config', { min: 1, max: Number.MAX_SAFE_INTEGER });
  }
  return normalized;
}

/** Parses a stored config column; a row that somehow lost its JSON reads as empty rather than crashing the tick. */
export function parseStoredConfig(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
