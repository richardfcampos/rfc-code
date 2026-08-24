import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import type { TaskAttachmentRow, TaskEvidenceRow, TaskRow } from '@/modules/database/index.js';
import type { TaskUpdateAction } from '@/modules/tasks/task-update-broadcast.js';
import { ensureTaskAttachmentsDir } from '@/modules/tasks/services/task-attachments.storage.js';
import { createTasksRouter } from '@/modules/tasks/tasks.routes.js';
import {
  TaskAttachmentNotFoundError,
  TaskEvidenceNotFoundError,
  TaskNotFoundError,
  TaskValidationError,
  type TaskDetail,
  type TasksService,
} from '@/modules/tasks/tasks.service.js';
import { AppError } from '@/shared/utils.js';

const TASK: TaskRow = {
  id: 'task-1',
  project_name: 'my-app',
  title: 'Ship it',
  description: 'Long form description',
  stage: 'backlog',
  origin: 'user',
  origin_detail: null,
  assignee_profile_id: null,
  suggested_skill: null,
  worktree_branch: null,
  created_at: '2026-08-10T00:00:00.000Z',
  updated_at: '2026-08-10T00:00:00.000Z',
};

const ATTACHMENT: TaskAttachmentRow = {
  attachment_id: 'attachment-1',
  task_id: TASK.id,
  file_name: 'notes.txt',
  mime_type: 'text/plain',
  size_bytes: 5,
  stored_path: '/tmp/does-not-matter.txt',
  created_at: '2026-08-10T00:00:00.000Z',
};

const EVIDENCE: TaskEvidenceRow = {
  evidence_id: 'evidence-1',
  task_id: TASK.id,
  kind: 'note',
  content: 'looks good',
  attachment_id: null,
  created_at: '2026-08-10T00:00:00.000Z',
};

function createFakeService(overrides: Partial<TasksService> = {}): TasksService {
  return {
    createTask: async () => {
      throw new Error('Unexpected createTask call');
    },
    listTasks: () => {
      throw new Error('Unexpected listTasks call');
    },
    getTaskDetail: (): TaskDetail => ({ task: TASK, attachments: [ATTACHMENT], evidence: [EVIDENCE] }),
    updateTask: async () => {
      throw new Error('Unexpected updateTask call');
    },
    deleteTask: () => {
      throw new Error('Unexpected deleteTask call');
    },
    addAttachment: () => {
      throw new Error('Unexpected addAttachment call');
    },
    getAttachment: () => {
      throw new Error('Unexpected getAttachment call');
    },
    deleteAttachment: () => {
      throw new Error('Unexpected deleteAttachment call');
    },
    addEvidence: () => {
      throw new Error('Unexpected addEvidence call');
    },
    deleteEvidence: () => {
      throw new Error('Unexpected deleteEvidence call');
    },
    ...overrides,
  };
}

async function withTasksServer(
  service: TasksService,
  broadcastCalls: Array<[TaskRow, TaskUpdateAction]>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/tasks',
    createTasksRouter(service, (task, action) => {
      broadcastCalls.push([task, action]);
    }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.code });
      return;
    }
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

/** Points the module's global storage folder (~/.cloudcli/task-attachments) at a scratch HOME for the test. */
async function withIsolatedAttachmentsHome(run: () => Promise<void>): Promise<void> {
  const previousHome = process.env.HOME;
  const tempHome = await mkdtemp(path.join(tmpdir(), 'tasks-attachments-home-'));
  process.env.HOME = tempHome;

  try {
    await run();
  } finally {
    process.env.HOME = previousHome;
    await rm(tempHome, { recursive: true, force: true });
  }
}

test('GET /:id returns the task detail with attachments and evidence', async () => {
  const service = createFakeService();
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}`);
    const payload = (await response.json()) as { data: TaskDetail };

    assert.equal(response.status, 200);
    assert.equal(payload.data.task.id, TASK.id);
    assert.deepEqual(payload.data.attachments, [ATTACHMENT]);
    assert.deepEqual(payload.data.evidence, [EVIDENCE]);
  });

  assert.equal(broadcastCalls.length, 0);
});

test('GET /:id maps a not-found error to 404', async () => {
  const service = createFakeService({
    getTaskDetail: () => {
      throw new TaskNotFoundError('missing-id');
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/missing-id`);
    assert.equal(response.status, 404);
  });
});

test('POST /:id/attachments stores the upload, returns 201, and broadcasts "updated"', async () => {
  await withIsolatedAttachmentsHome(async () => {
    const addAttachmentCalls: Array<[unknown, Record<string, unknown>]> = [];
    const service = createFakeService({
      addAttachment: (taskId, file) => {
        addAttachmentCalls.push([taskId, file as unknown as Record<string, unknown>]);
        return { ...ATTACHMENT, stored_path: file.storedPath, file_name: file.fileName };
      },
    });
    const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

    await withTasksServer(service, broadcastCalls, async (baseUrl) => {
      const form = new FormData();
      form.append('file', new Blob(['hello world'], { type: 'text/plain' }), 'notes.txt');

      const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/attachments`, {
        method: 'POST',
        body: form,
      });
      const payload = (await response.json()) as { data: { attachment: TaskAttachmentRow } };

      assert.equal(response.status, 201);
      assert.equal(payload.data.attachment.file_name, 'notes.txt');
    });

    assert.equal(addAttachmentCalls.length, 1);
    assert.equal(addAttachmentCalls[0]![0], TASK.id);
    assert.equal(addAttachmentCalls[0]![1].fileName, 'notes.txt');
    assert.equal(addAttachmentCalls[0]![1].mimeType, 'text/plain');
    assert.equal(addAttachmentCalls[0]![1].sizeBytes, 'hello world'.length);

    assert.equal(broadcastCalls.length, 1);
    assert.equal(broadcastCalls[0]![1], 'updated');

    // The uploaded file must actually land on disk at the stored path.
    const storedPath = addAttachmentCalls[0]![1].storedPath as string;
    const contents = await readFile(storedPath, 'utf8');
    assert.equal(contents, 'hello world');
  });
});

test('POST /:id/attachments requires a file', async () => {
  await withIsolatedAttachmentsHome(async () => {
    const service = createFakeService();
    const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

    await withTasksServer(service, broadcastCalls, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/attachments`, {
        method: 'POST',
        body: new FormData(),
      });
      assert.equal(response.status, 400);
    });

    assert.equal(broadcastCalls.length, 0);
  });
});

test('POST /:id/attachments cleans up the uploaded file when the service rejects the task', async () => {
  await withIsolatedAttachmentsHome(async () => {
    let capturedStoredPath = '';
    const service = createFakeService({
      addAttachment: (_taskId, file) => {
        capturedStoredPath = file.storedPath;
        throw new TaskNotFoundError('missing-id');
      },
    });
    const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

    await withTasksServer(service, broadcastCalls, async (baseUrl) => {
      const form = new FormData();
      form.append('file', new Blob(['x']), 'x.txt');

      const response = await fetch(`${baseUrl}/api/tasks/missing-id/attachments`, {
        method: 'POST',
        body: form,
      });
      assert.equal(response.status, 404);
    });

    assert.ok(capturedStoredPath);
    await assert.rejects(() => access(capturedStoredPath));
    assert.equal(broadcastCalls.length, 0);
  });
});

test('GET /:id/attachments/:attachmentId/download streams the file with safe headers', async () => {
  await withIsolatedAttachmentsHome(async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'tasks-attachment-file-'));
    const filePath = path.join(tempDir, 'design.svg');
    await writeFile(filePath, '<svg></svg>');

    const service = createFakeService({
      getAttachment: () => ({ ...ATTACHMENT, mime_type: 'image/svg+xml', stored_path: filePath }),
    });
    const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

    try {
      await withTasksServer(service, broadcastCalls, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/attachments/${ATTACHMENT.attachment_id}/download`);

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/svg+xml');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.match(response.headers.get('content-disposition') ?? '', /^attachment; filename="notes\.txt"$/);
        assert.equal(await response.text(), '<svg></svg>');
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('GET /:id/attachments/:attachmentId/download answers 404 when the file is missing on disk', async () => {
  await withIsolatedAttachmentsHome(async () => {
    const service = createFakeService({
      getAttachment: () => ({ ...ATTACHMENT, stored_path: '/tmp/does-not-exist-1234567890.bin' }),
    });
    const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

    await withTasksServer(service, broadcastCalls, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/attachments/${ATTACHMENT.attachment_id}/download`);
      assert.equal(response.status, 404);
    });
  });
});

test('GET /:id/attachments/:attachmentId/download maps an unknown attachment to 404', async () => {
  const service = createFakeService({
    getAttachment: () => {
      throw new TaskAttachmentNotFoundError('missing-attachment');
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/attachments/missing-attachment/download`);
    assert.equal(response.status, 404);
  });
});

test('DELETE /:id/attachments/:attachmentId deletes the row, removes the file, and broadcasts "updated"', async () => {
  await withIsolatedAttachmentsHome(async () => {
    const attachmentsDir = await ensureTaskAttachmentsDir();
    const filePath = path.join(attachmentsDir, 'to-delete.txt');
    await writeFile(filePath, 'bye');

    const deleteCalls: Array<[unknown, unknown]> = [];
    const service = createFakeService({
      deleteAttachment: (taskId, attachmentId) => {
        deleteCalls.push([taskId, attachmentId]);
        return { ...ATTACHMENT, stored_path: filePath };
      },
    });
    const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

    await withTasksServer(service, broadcastCalls, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/attachments/${ATTACHMENT.attachment_id}`, {
        method: 'DELETE',
      });
      assert.equal(response.status, 200);
    });

    assert.deepEqual(deleteCalls, [[TASK.id, ATTACHMENT.attachment_id]]);
    assert.equal(broadcastCalls.length, 1);
    assert.equal(broadcastCalls[0]![1], 'updated');
    await assert.rejects(() => access(filePath));
  });
});

test('DELETE /:id/attachments/:attachmentId maps a not-found error to 404 and does not broadcast', async () => {
  const service = createFakeService({
    deleteAttachment: () => {
      throw new TaskAttachmentNotFoundError('missing-attachment');
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/attachments/missing-attachment`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 404);
  });

  assert.equal(broadcastCalls.length, 0);
});

test('POST /:id/evidence creates evidence, returns 201, and broadcasts "updated"', async () => {
  const addEvidenceCalls: Array<[unknown, Record<string, unknown>]> = [];
  const service = createFakeService({
    addEvidence: (taskId, body) => {
      addEvidenceCalls.push([taskId, body]);
      return EVIDENCE;
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'note', content: 'looks good' }),
    });
    const payload = (await response.json()) as { data: { evidence: TaskEvidenceRow } };

    assert.equal(response.status, 201);
    assert.equal(payload.data.evidence.evidence_id, EVIDENCE.evidence_id);
  });

  assert.deepEqual(addEvidenceCalls, [[TASK.id, { kind: 'note', content: 'looks good' }]]);
  assert.equal(broadcastCalls.length, 1);
  assert.equal(broadcastCalls[0]![1], 'updated');
});

test('POST /:id/evidence maps a validation error to 400 and does not broadcast', async () => {
  const service = createFakeService({
    addEvidence: () => {
      throw new TaskValidationError('content is required');
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'note' }),
    });
    assert.equal(response.status, 400);
  });

  assert.equal(broadcastCalls.length, 0);
});

test('DELETE /:id/evidence/:evidenceId deletes and broadcasts "updated"', async () => {
  const deleteCalls: Array<[unknown, unknown]> = [];
  const service = createFakeService({
    deleteEvidence: (taskId, evidenceId) => {
      deleteCalls.push([taskId, evidenceId]);
      return EVIDENCE;
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/evidence/${EVIDENCE.evidence_id}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 200);
  });

  assert.deepEqual(deleteCalls, [[TASK.id, EVIDENCE.evidence_id]]);
  assert.equal(broadcastCalls.length, 1);
  assert.equal(broadcastCalls[0]![1], 'updated');
});

test('DELETE /:id/evidence/:evidenceId maps a not-found error to 404 and does not broadcast', async () => {
  const service = createFakeService({
    deleteEvidence: () => {
      throw new TaskEvidenceNotFoundError('missing-evidence');
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/${TASK.id}/evidence/missing-evidence`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 404);
  });

  assert.equal(broadcastCalls.length, 0);
});
