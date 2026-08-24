/**
 * REST surface for the native task board: `/api/tasks`.
 *
 * Thin controllers only — validation of untrusted input and all business
 * rules live in `tasksService`; these handlers translate HTTP to service
 * calls and wrap results in the shared success envelope. Named errors thrown
 * by the service (`TaskValidationError`, `TaskNotFoundError`, ...) bubble to
 * the global error middleware, which maps them via `AppError.statusCode`.
 *
 * Attachment upload/download follows the same multer + disk-storage idiom as
 * `modules/assets`, scoped to the tasks module's own storage folder (see
 * `services/task-attachments.storage.ts`). The whole router is mounted
 * behind `authenticateToken` by the server entrypoint, so every route here —
 * including the download route — already requires an authenticated caller.
 */

import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';

import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import type { TaskRow } from '@/modules/database/index.js';
import {
  buildStoredAttachmentFilename,
  deleteStoredAttachmentFile,
  ensureTaskAttachmentsDir,
  getTaskAttachmentsDir,
  TASK_ATTACHMENT_MAX_SIZE_BYTES,
} from '@/modules/tasks/services/task-attachments.storage.js';
import { broadcastTaskUpdate, type TaskUpdateAction } from '@/modules/tasks/task-update-broadcast.js';
import { TaskValidationError } from '@/modules/tasks/tasks.errors.js';
import type { TasksService } from '@/modules/tasks/tasks.service.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

export type TaskBroadcast = (task: TaskRow, action: TaskUpdateAction) => void;

const attachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureTaskAttachmentsDir()
      .then((dir) => cb(null, dir))
      .catch((error) => cb(error as Error, ''));
  },
  filename: (_req, file, cb) => {
    cb(null, buildStoredAttachmentFilename(file.originalname));
  },
});

// Task attachments can be any document or image the board wants to keep —
// never sent to a model API as inline content — so, like the generic chat
// file upload, no mime-type allow-list applies here; the download route
// below always forces a download instead of rendering the file inline.
const attachmentUpload = multer({
  storage: attachmentStorage,
  limits: { fileSize: TASK_ATTACHMENT_MAX_SIZE_BYTES, files: 1 },
});

/** Routes a multer error through the same named-error path every other validation failure takes. */
function handleAttachmentUpload(req: Request, res: Response, next: NextFunction): void {
  attachmentUpload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      next(new TaskValidationError(message));
      return;
    }
    next();
  });
}

/** CRLF/quote-safe filename for the download response's Content-Disposition header. */
function contentDispositionAttachment(fileName: string): string {
  const sanitized = fileName.replace(/[\r\n"]/g, '_');
  return `attachment; filename="${sanitized}"`;
}

/**
 * Builds the Tasks HTTP router around an injected application-service API.
 *
 * `broadcast` defaults to the real WebSocket fan-out but is overridable so
 * route tests can assert broadcast behavior without a live socket.
 */
export function createTasksRouter(
  service: TasksService,
  broadcast: TaskBroadcast = broadcastTaskUpdate,
): express.Router {
  const router = express.Router();

  /** Every attachment/evidence mutation broadcasts the parent task so open boards refetch its detail. */
  function broadcastTaskDetailUpdate(taskId: unknown): void {
    broadcast(service.getTaskDetail(taskId).task, 'updated');
  }

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const tasks = await service.listTasks(req.query.project);
      res.json(createApiSuccessResponse({ tasks }));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const task = await service.createTask(body);
      broadcast(task, 'created');
      res.status(201).json(createApiSuccessResponse({ task }));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const detail = service.getTaskDetail(req.params.id);
      res.json(createApiSuccessResponse(detail));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const task = await service.updateTask(req.params.id, body);
      broadcast(task, 'updated');
      res.json(createApiSuccessResponse({ task }));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const task = await service.deleteTask(req.params.id);
      broadcast(task, 'deleted');
      res.json(createApiSuccessResponse({ task }));
    }),
  );

  router.post(
    '/:id/attachments',
    handleAttachmentUpload,
    asyncHandler(async (req: Request, res: Response) => {
      const file = req.file;
      if (!file) {
        throw new TaskValidationError('file is required');
      }

      const storedPath = path.join(getTaskAttachmentsDir(), file.filename);
      try {
        const attachment = service.addAttachment(req.params.id, {
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storedPath,
        });
        broadcastTaskDetailUpdate(req.params.id);
        res.status(201).json(createApiSuccessResponse({ attachment }));
      } catch (error) {
        // The task the caller named may not exist, or the upload may fail
        // validation (oversized filename, ...) — either way the file multer
        // already wrote must not linger with no database row pointing at it.
        await deleteStoredAttachmentFile(storedPath);
        throw error;
      }
    }),
  );

  router.get(
    '/:id/attachments/:attachmentId/download',
    asyncHandler(async (req: Request, res: Response) => {
      const attachment = service.getAttachment(req.params.id, req.params.attachmentId);

      try {
        await fs.access(attachment.stored_path);
      } catch {
        res.status(404).json({
          success: false,
          error: { code: 'TASK_ATTACHMENT_FILE_MISSING', message: 'Attachment file is missing on disk' },
        });
        return;
      }

      res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
      // Stored-XSS hardening, same as modules/assets: never let the browser
      // sniff a different type, and always force a download rather than an
      // inline render (an HTML/SVG attachment must never execute in the app origin).
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', contentDispositionAttachment(attachment.file_name));
      const fileStream = fsSync.createReadStream(attachment.stored_path);
      fileStream.pipe(res);
      fileStream.on('error', (error) => {
        console.error('[tasks] error streaming attachment:', error);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Error reading attachment' },
          });
        }
      });
    }),
  );

  router.delete(
    '/:id/attachments/:attachmentId',
    asyncHandler(async (req: Request, res: Response) => {
      const attachment = service.deleteAttachment(req.params.id, req.params.attachmentId);
      await deleteStoredAttachmentFile(attachment.stored_path);
      broadcastTaskDetailUpdate(req.params.id);
      res.json(createApiSuccessResponse({ attachment }));
    }),
  );

  router.post(
    '/:id/evidence',
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const evidence = service.addEvidence(req.params.id, body);
      broadcastTaskDetailUpdate(req.params.id);
      res.status(201).json(createApiSuccessResponse({ evidence }));
    }),
  );

  router.delete(
    '/:id/evidence/:evidenceId',
    asyncHandler(async (req: Request, res: Response) => {
      const evidence = service.deleteEvidence(req.params.id, req.params.evidenceId);
      broadcastTaskDetailUpdate(req.params.id);
      res.json(createApiSuccessResponse({ evidence }));
    }),
  );

  return router;
}
