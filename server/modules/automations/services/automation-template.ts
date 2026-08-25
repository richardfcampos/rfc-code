/**
 * `{{placeholder}}` interpolation for the text an automation produces.
 *
 * The variable map is built by whichever trigger fired, so a prompt written for
 * the board (`{{task}}`, `{{task.stage}}`) reads the task that moved, and one
 * written for a webhook reads that request's payload. An unknown placeholder
 * renders as an empty string rather than leaking its own braces into a prompt a
 * model is about to read.
 */

import type { AutomationRow, TaskRow } from '@/modules/database/index.js';

const PLACEHOLDER_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => variables[name] ?? '');
}

/** Variables every firing carries, whatever triggered it. */
export function baseVariables(automation: AutomationRow, firedAt: Date): Record<string, string> {
  return {
    'automation.id': automation.automation_id,
    'automation.name': automation.name,
    firedAt: firedAt.toISOString(),
  };
}

/**
 * Variables for a task-stage firing.
 *
 * `{{task}}` on its own is the title: it is what a prompt template almost always
 * means, and spelling out `{{task.title}}` for the common case would be noise.
 */
export function taskVariables(task: TaskRow, previousStage: string | null): Record<string, string> {
  return {
    task: task.title,
    'task.id': task.id,
    'task.title': task.title,
    'task.description': task.description ?? '',
    'task.stage': task.stage,
    'task.previousStage': previousStage ?? '',
    'task.project': task.project_name,
    'task.skill': task.suggested_skill ?? '',
    'task.assignee': task.assignee_profile_id ?? '',
    'task.worktreeBranch': task.worktree_branch ?? '',
  };
}

/**
 * Variables for a webhook firing: the payload's scalar top-level fields.
 *
 * Only scalars, and only one level deep: a template is a line of text, and
 * splicing an arbitrary nested object into a prompt (or a task title) is a way
 * to smuggle a wall of attacker-controlled text into it.
 */
export function payloadVariables(payload: unknown): Record<string, string> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return {};
  }

  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      variables[`payload.${key}`] = String(value);
    }
  }
  return variables;
}

/** Variables for a quota firing. */
export function quotaVariables(profileId: string, usagePct: number, thresholdPct: number): Record<string, string> {
  return {
    'quota.profileId': profileId,
    'quota.usagePct': String(Math.round(usagePct)),
    'quota.thresholdPct': String(thresholdPct),
  };
}
