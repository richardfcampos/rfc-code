/**
 * Application service for the native task board: `server/modules/tasks`.
 *
 * Owns all validation of untrusted input for tasks (title, stage, project)
 * before it reaches `tasksDb`. Named error classes (`TaskValidationError`,
 * `TaskNotFoundError`) extend the shared `AppError` so the existing global
 * error middleware maps them to HTTP status codes without any route-level
 * branching.
 */

import {
  tasksDb,
  type CreateTaskInput,
  type TaskOrigin,
  type TaskRow,
  type TaskStage,
  type UpdateTaskInput,
} from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

const TASK_STAGES: readonly TaskStage[] = ['backlog', 'in_progress', 'review', 'done'];
const TASK_ORIGINS: readonly TaskOrigin[] = ['user', 'agent', 'automation'];
const TITLE_MAX_LENGTH = 500;

export class TaskValidationError extends AppError {
  constructor(message: string) {
    super(message, { code: 'TASK_VALIDATION_ERROR', statusCode: 400 });
    this.name = 'TaskValidationError';
  }
}

export class TaskNotFoundError extends AppError {
  constructor(id: string) {
    super(`Task "${id}" not found`, { code: 'TASK_NOT_FOUND', statusCode: 404 });
    this.name = 'TaskNotFoundError';
  }
}

/**
 * Assignee-eligibility policy hook, injected by the module's composition
 * root. Called only when a caller sets a non-null `assignee_profile_id`.
 * Should throw an `AppError` (403) to deny the assignment.
 */
export type AssertAssigneeAllowed = (
  projectName: string,
  profileId: string,
) => void | Promise<void>;

export type TasksServiceDeps = {
  assertAssigneeAllowed: AssertAssigneeAllowed;
};

/** Raw request bodies straight off the wire; every field is unvalidated. */
export type CreateTaskRequestBody = Record<string, unknown>;
export type UpdateTaskRequestBody = Record<string, unknown>;

export type TasksService = {
  createTask(body: CreateTaskRequestBody): Promise<TaskRow>;
  listTasks(project: unknown): TaskRow[];
  updateTask(id: unknown, body: UpdateTaskRequestBody): Promise<TaskRow>;
  deleteTask(id: unknown): TaskRow;
};

function validateTitle(rawTitle: unknown): string {
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (!title) {
    throw new TaskValidationError('title is required');
  }
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TaskValidationError(`title must be ${TITLE_MAX_LENGTH} characters or fewer`);
  }
  return title;
}

function validateStage(rawStage: unknown): TaskStage {
  if (typeof rawStage !== 'string' || !TASK_STAGES.includes(rawStage as TaskStage)) {
    throw new TaskValidationError(`stage must be one of: ${TASK_STAGES.join(', ')}`);
  }
  return rawStage as TaskStage;
}

function validateProject(rawProject: unknown): string {
  const project = typeof rawProject === 'string' ? rawProject.trim() : '';
  if (!project) {
    throw new TaskValidationError('project is required');
  }
  return project;
}

function validateOrigin(rawOrigin: unknown): TaskOrigin | undefined {
  if (rawOrigin === undefined) {
    return undefined;
  }
  if (typeof rawOrigin !== 'string' || !TASK_ORIGINS.includes(rawOrigin as TaskOrigin)) {
    throw new TaskValidationError(`origin must be one of: ${TASK_ORIGINS.join(', ')}`);
  }
  return rawOrigin as TaskOrigin;
}

/**
 * Reads an optional, nullable string field from a raw request body.
 *
 * `undefined` means "field absent" (leave untouched on update / default on
 * create); `null` or an empty string both mean "clear the field".
 */
function readOptionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  throw new TaskValidationError(`${field} must be a string or null`);
}

function requireTaskId(id: unknown): string {
  const taskId = typeof id === 'string' ? id.trim() : '';
  if (!taskId) {
    throw new TaskValidationError('id is required');
  }
  return taskId;
}

async function createTask(
  deps: TasksServiceDeps,
  body: CreateTaskRequestBody,
): Promise<TaskRow> {
  const title = validateTitle(body.title);
  const project = validateProject(body.project);
  const origin = validateOrigin(body.origin);
  const description = readOptionalNullableString(body.description, 'description');
  const originDetail = readOptionalNullableString(body.origin_detail, 'origin_detail');
  const assigneeProfileId = readOptionalNullableString(body.assignee_profile_id, 'assignee_profile_id');
  const suggestedSkill = readOptionalNullableString(body.suggested_skill, 'suggested_skill');
  const worktreeBranch = readOptionalNullableString(body.worktree_branch, 'worktree_branch');

  if (assigneeProfileId) {
    await deps.assertAssigneeAllowed(project, assigneeProfileId);
  }

  const input: CreateTaskInput = {
    title,
    projectName: project,
    description: description ?? null,
    origin,
    originDetail: originDetail ?? null,
    assigneeProfileId: assigneeProfileId ?? null,
    suggestedSkill: suggestedSkill ?? null,
    worktreeBranch: worktreeBranch ?? null,
  };

  return tasksDb.create(input);
}

function listTasks(project: unknown): TaskRow[] {
  return tasksDb.listByProject(validateProject(project));
}

async function updateTask(
  deps: TasksServiceDeps,
  rawId: unknown,
  body: UpdateTaskRequestBody,
): Promise<TaskRow> {
  const id = requireTaskId(rawId);
  const existing = tasksDb.get(id);
  if (!existing) {
    throw new TaskNotFoundError(id);
  }

  const fields: UpdateTaskInput = {};

  if (body.title !== undefined) {
    fields.title = validateTitle(body.title);
  }
  if (body.stage !== undefined) {
    fields.stage = validateStage(body.stage);
  }
  if (body.description !== undefined) {
    fields.description = readOptionalNullableString(body.description, 'description') ?? null;
  }
  if (body.assignee_profile_id !== undefined) {
    const assigneeProfileId = readOptionalNullableString(body.assignee_profile_id, 'assignee_profile_id');
    if (assigneeProfileId) {
      await deps.assertAssigneeAllowed(existing.project_name, assigneeProfileId);
    }
    fields.assigneeProfileId = assigneeProfileId ?? null;
  }
  if (body.suggested_skill !== undefined) {
    fields.suggestedSkill = readOptionalNullableString(body.suggested_skill, 'suggested_skill') ?? null;
  }
  if (body.worktree_branch !== undefined) {
    fields.worktreeBranch = readOptionalNullableString(body.worktree_branch, 'worktree_branch') ?? null;
  }

  const updated = tasksDb.update(id, fields);
  if (!updated) {
    throw new TaskNotFoundError(id);
  }
  return updated;
}

function deleteTask(rawId: unknown): TaskRow {
  const id = requireTaskId(rawId);
  const existing = tasksDb.get(id);
  if (!existing) {
    throw new TaskNotFoundError(id);
  }
  tasksDb.delete(id);
  return existing;
}

/**
 * Composition root for the Tasks application service.
 *
 * Keeping the policy hook as an injected dependency means this module never
 * imports the orgs module directly, avoiding a cross-module coupling before
 * the policy resolver exists.
 */
export function createTasksService(deps: TasksServiceDeps): TasksService {
  return {
    createTask: (body) => createTask(deps, body),
    listTasks: (project) => listTasks(project),
    updateTask: (id, body) => updateTask(deps, id, body),
    deleteTask: (id) => deleteTask(id),
  };
}
