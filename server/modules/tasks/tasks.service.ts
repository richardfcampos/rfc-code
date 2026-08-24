/**
 * Application service for the native task board: `server/modules/tasks`.
 *
 * Orchestrates the repositories behind the task board's rich fields
 * (description, attachments, evidence): every id-scoped lookup happens here,
 * field-level validation lives in `tasks.validation.ts`, and named errors
 * live in `tasks.errors.ts` — the existing global error middleware maps them
 * to HTTP status codes without any route-level branching.
 */

import {
  taskAttachmentsDb,
  taskEvidenceDb,
  tasksDb,
  type CreateTaskInput,
  type TaskAttachmentRow,
  type TaskEvidenceRow,
  type TaskRow,
  type UpdateTaskInput,
} from '@/modules/database/index.js';

import {
  TaskAttachmentNotFoundError,
  TaskEvidenceNotFoundError,
  TaskNotFoundError,
  TaskValidationError,
} from './tasks.errors.js';
import {
  readOptionalNullableString,
  requireAttachmentId,
  requireEvidenceId,
  requireTaskId,
  validateAttachmentFileName,
  validateAttachmentMimeType,
  validateAttachmentSize,
  validateEvidenceContent,
  validateEvidenceKind,
  validateOrigin,
  validateProject,
  validateStage,
  validateStoredPath,
  validateTitle,
} from './tasks.validation.js';

export {
  TaskAttachmentNotFoundError,
  TaskEvidenceNotFoundError,
  TaskNotFoundError,
  TaskValidationError,
} from './tasks.errors.js';
export { TASK_ATTACHMENT_MAX_SIZE_BYTES } from './tasks.validation.js';

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
export type CreateEvidenceRequestBody = Record<string, unknown>;

/** A task plus its rich fields, assembled for the task detail view. */
export type TaskDetail = {
  task: TaskRow;
  attachments: TaskAttachmentRow[];
  evidence: TaskEvidenceRow[];
};

/**
 * Metadata for a file the route already wrote to disk (via multer) before
 * calling the service. The service never touches the filesystem itself —
 * upload and cleanup stay in the route layer, next to the multer wiring.
 */
export type UploadedAttachmentInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storedPath: string;
};

export type TasksService = {
  createTask(body: CreateTaskRequestBody): Promise<TaskRow>;
  listTasks(project: unknown): TaskRow[];
  getTaskDetail(id: unknown): TaskDetail;
  updateTask(id: unknown, body: UpdateTaskRequestBody): Promise<TaskRow>;
  deleteTask(id: unknown): TaskRow;
  addAttachment(taskId: unknown, file: UploadedAttachmentInput): TaskAttachmentRow;
  getAttachment(taskId: unknown, attachmentId: unknown): TaskAttachmentRow;
  deleteAttachment(taskId: unknown, attachmentId: unknown): TaskAttachmentRow;
  addEvidence(taskId: unknown, body: CreateEvidenceRequestBody): TaskEvidenceRow;
  deleteEvidence(taskId: unknown, evidenceId: unknown): TaskEvidenceRow;
};

/** Resolves a task id to its row, or throws the 404 every other lookup here throws. */
function requireTask(id: string): TaskRow {
  const task = tasksDb.get(id);
  if (!task) {
    throw new TaskNotFoundError(id);
  }
  return task;
}

/** Resolves an attachment id scoped to one task, or 404s — including when the id belongs to a different task. */
function requireAttachmentOnTask(taskId: string, rawAttachmentId: unknown): TaskAttachmentRow {
  const attachmentId = requireAttachmentId(rawAttachmentId);
  const attachment = taskAttachmentsDb.get(attachmentId);
  if (!attachment || attachment.task_id !== taskId) {
    throw new TaskAttachmentNotFoundError(attachmentId);
  }
  return attachment;
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

function getTaskDetail(rawId: unknown): TaskDetail {
  const id = requireTaskId(rawId);
  const task = requireTask(id);
  return {
    task,
    attachments: taskAttachmentsDb.listByTask(id),
    evidence: taskEvidenceDb.listByTask(id),
  };
}

async function updateTask(
  deps: TasksServiceDeps,
  rawId: unknown,
  body: UpdateTaskRequestBody,
): Promise<TaskRow> {
  const id = requireTaskId(rawId);
  const existing = requireTask(id);

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
  const existing = requireTask(id);
  tasksDb.delete(id);
  return existing;
}

function addAttachment(rawTaskId: unknown, file: UploadedAttachmentInput): TaskAttachmentRow {
  const taskId = requireTaskId(rawTaskId);
  requireTask(taskId);

  return taskAttachmentsDb.create({
    taskId,
    fileName: validateAttachmentFileName(file.fileName),
    mimeType: validateAttachmentMimeType(file.mimeType),
    sizeBytes: validateAttachmentSize(file.sizeBytes),
    storedPath: validateStoredPath(file.storedPath),
  });
}

function getAttachment(rawTaskId: unknown, rawAttachmentId: unknown): TaskAttachmentRow {
  const taskId = requireTaskId(rawTaskId);
  requireTask(taskId);
  return requireAttachmentOnTask(taskId, rawAttachmentId);
}

function deleteAttachment(rawTaskId: unknown, rawAttachmentId: unknown): TaskAttachmentRow {
  const taskId = requireTaskId(rawTaskId);
  requireTask(taskId);
  const attachment = requireAttachmentOnTask(taskId, rawAttachmentId);

  taskAttachmentsDb.delete(attachment.attachment_id);
  return attachment;
}

function addEvidence(rawTaskId: unknown, body: CreateEvidenceRequestBody): TaskEvidenceRow {
  const taskId = requireTaskId(rawTaskId);
  requireTask(taskId);

  const kind = validateEvidenceKind(body.kind);
  const content = validateEvidenceContent(body.content);

  let attachmentId: string | null = null;
  if (kind === 'attachment') {
    // Evidence of kind "attachment" documents a file the task already has;
    // it never uploads a new one, so the id must resolve on this same task.
    attachmentId = requireAttachmentOnTask(taskId, body.attachment_id).attachment_id;
  } else if (body.attachment_id !== undefined && body.attachment_id !== null) {
    throw new TaskValidationError('attachment_id is only allowed for evidence of kind "attachment"');
  }

  return taskEvidenceDb.create({ taskId, kind, content, attachmentId });
}

function deleteEvidence(rawTaskId: unknown, rawEvidenceId: unknown): TaskEvidenceRow {
  const taskId = requireTaskId(rawTaskId);
  requireTask(taskId);

  const evidenceId = requireEvidenceId(rawEvidenceId);
  const evidence = taskEvidenceDb.get(evidenceId);
  if (!evidence || evidence.task_id !== taskId) {
    throw new TaskEvidenceNotFoundError(evidenceId);
  }

  taskEvidenceDb.delete(evidenceId);
  return evidence;
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
    getTaskDetail: (id) => getTaskDetail(id),
    updateTask: (id, body) => updateTask(deps, id, body),
    deleteTask: (id) => deleteTask(id),
    addAttachment: (taskId, file) => addAttachment(taskId, file),
    getAttachment: (taskId, attachmentId) => getAttachment(taskId, attachmentId),
    deleteAttachment: (taskId, attachmentId) => deleteAttachment(taskId, attachmentId),
    addEvidence: (taskId, body) => addEvidence(taskId, body),
    deleteEvidence: (taskId, evidenceId) => deleteEvidence(taskId, evidenceId),
  };
}
