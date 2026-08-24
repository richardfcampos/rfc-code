/**
 * Named failures of the Tasks module: `server/modules/tasks`.
 *
 * All extend the shared `AppError`, so the global error middleware maps them
 * to a status and a `{ success: false, error: { code, message } }` body
 * without any route-level branching.
 */

import { AppError } from '@/shared/utils.js';

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

export class TaskAttachmentNotFoundError extends AppError {
  constructor(id: string) {
    super(`Attachment "${id}" not found on this task`, { code: 'TASK_ATTACHMENT_NOT_FOUND', statusCode: 404 });
    this.name = 'TaskAttachmentNotFoundError';
  }
}

export class TaskEvidenceNotFoundError extends AppError {
  constructor(id: string) {
    super(`Evidence "${id}" not found on this task`, { code: 'TASK_EVIDENCE_NOT_FOUND', statusCode: 404 });
    this.name = 'TaskEvidenceNotFoundError';
  }
}
