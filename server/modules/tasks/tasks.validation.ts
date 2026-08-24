/**
 * Pure input validation for the native task board: `server/modules/tasks`.
 *
 * Every function here takes an `unknown` value straight off the wire and
 * either returns a narrowed, trusted value or throws `TaskValidationError`.
 * None of them touch the database — id-scoped existence checks (does this
 * task/attachment/evidence row actually exist) live in `tasks.service.ts`
 * next to the repositories they call.
 */

import type { TaskEvidenceKind, TaskOrigin, TaskStage } from '@/modules/database/index.js';

import { TaskValidationError } from './tasks.errors.js';

export const TASK_STAGES: readonly TaskStage[] = ['backlog', 'in_progress', 'review', 'done'];
export const TASK_ORIGINS: readonly TaskOrigin[] = ['user', 'agent', 'automation'];
export const TASK_EVIDENCE_KINDS: readonly TaskEvidenceKind[] = ['note', 'link', 'attachment'];

const TITLE_MAX_LENGTH = 500;
const ATTACHMENT_FILE_NAME_MAX_LENGTH = 255;
const EVIDENCE_CONTENT_MAX_LENGTH = 10_000;
/** Same cap the multipart upload route enforces; re-checked here as defense in depth. */
export const TASK_ATTACHMENT_MAX_SIZE_BYTES = 20 * 1024 * 1024;

export function validateTitle(rawTitle: unknown): string {
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (!title) {
    throw new TaskValidationError('title is required');
  }
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TaskValidationError(`title must be ${TITLE_MAX_LENGTH} characters or fewer`);
  }
  return title;
}

export function validateStage(rawStage: unknown): TaskStage {
  if (typeof rawStage !== 'string' || !TASK_STAGES.includes(rawStage as TaskStage)) {
    throw new TaskValidationError(`stage must be one of: ${TASK_STAGES.join(', ')}`);
  }
  return rawStage as TaskStage;
}

export function validateProject(rawProject: unknown): string {
  const project = typeof rawProject === 'string' ? rawProject.trim() : '';
  if (!project) {
    throw new TaskValidationError('project is required');
  }
  return project;
}

export function validateOrigin(rawOrigin: unknown): TaskOrigin | undefined {
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
export function readOptionalNullableString(value: unknown, field: string): string | null | undefined {
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

export function requireTaskId(id: unknown): string {
  const taskId = typeof id === 'string' ? id.trim() : '';
  if (!taskId) {
    throw new TaskValidationError('id is required');
  }
  return taskId;
}

export function requireAttachmentId(id: unknown): string {
  const attachmentId = typeof id === 'string' ? id.trim() : '';
  if (!attachmentId) {
    throw new TaskValidationError('attachmentId is required');
  }
  return attachmentId;
}

export function requireEvidenceId(id: unknown): string {
  const evidenceId = typeof id === 'string' ? id.trim() : '';
  if (!evidenceId) {
    throw new TaskValidationError('evidenceId is required');
  }
  return evidenceId;
}

export function validateAttachmentFileName(rawFileName: unknown): string {
  const fileName = typeof rawFileName === 'string' ? rawFileName.trim() : '';
  if (!fileName) {
    throw new TaskValidationError('file name is required');
  }
  if (fileName.length > ATTACHMENT_FILE_NAME_MAX_LENGTH) {
    throw new TaskValidationError(`file name must be ${ATTACHMENT_FILE_NAME_MAX_LENGTH} characters or fewer`);
  }
  return fileName;
}

export function validateAttachmentMimeType(rawMimeType: unknown): string {
  const mimeType = typeof rawMimeType === 'string' ? rawMimeType.trim() : '';
  if (!mimeType) {
    throw new TaskValidationError('mime type is required');
  }
  return mimeType;
}

export function validateAttachmentSize(rawSizeBytes: unknown): number {
  if (typeof rawSizeBytes !== 'number' || !Number.isFinite(rawSizeBytes) || rawSizeBytes <= 0) {
    throw new TaskValidationError('size in bytes must be a positive number');
  }
  if (rawSizeBytes > TASK_ATTACHMENT_MAX_SIZE_BYTES) {
    throw new TaskValidationError(`attachment exceeds the ${TASK_ATTACHMENT_MAX_SIZE_BYTES} byte limit`);
  }
  return rawSizeBytes;
}

export function validateStoredPath(rawStoredPath: unknown): string {
  const storedPath = typeof rawStoredPath === 'string' ? rawStoredPath.trim() : '';
  if (!storedPath) {
    throw new TaskValidationError('stored path is required');
  }
  return storedPath;
}

export function validateEvidenceKind(rawKind: unknown): TaskEvidenceKind {
  const kind = typeof rawKind === 'string' ? rawKind.trim() : '';
  if (!TASK_EVIDENCE_KINDS.includes(kind as TaskEvidenceKind)) {
    throw new TaskValidationError(`kind must be one of: ${TASK_EVIDENCE_KINDS.join(', ')}`);
  }
  return kind as TaskEvidenceKind;
}

export function validateEvidenceContent(rawContent: unknown): string {
  const content = typeof rawContent === 'string' ? rawContent.trim() : '';
  if (!content) {
    throw new TaskValidationError('content is required');
  }
  if (content.length > EVIDENCE_CONTENT_MAX_LENGTH) {
    throw new TaskValidationError(`content must be ${EVIDENCE_CONTENT_MAX_LENGTH} characters or fewer`);
  }
  return content;
}
