import { useCallback, type Dispatch, type SetStateAction } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { Task, TaskAttachment, TaskDetail, TaskEvidence, TaskEvidenceKind } from '../types';

interface TaskMutationResponse {
  success?: boolean;
  data?: { task?: Task };
}

interface AttachmentMutationResponse {
  success?: boolean;
  data?: { attachment?: TaskAttachment };
}

interface EvidenceMutationResponse {
  success?: boolean;
  data?: { evidence?: TaskEvidence };
}

/**
 * Mutations for the task detail view: description edits, attachment
 * upload/delete, evidence add/delete. Every call applies against the shared
 * `detail` state so the open view reflects its own writes immediately,
 * without waiting for the `task_update` WS round-trip that `useTaskDetail`
 * also listens for as the cross-client confirmation path.
 */
export function useTaskDetailMutations(
  taskId: string | undefined,
  setDetail: Dispatch<SetStateAction<TaskDetail | null>>,
) {
  const updateDescription = useCallback(
    async (description: string) => {
      if (!taskId) {
        return;
      }
      const response = await authenticatedFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ description }),
      });
      const body = (await response.json()) as TaskMutationResponse;
      if (!response.ok || !body.success || !body.data?.task) {
        throw new Error('Failed to save description');
      }
      const updatedTask = body.data.task;
      setDetail((previous) => (previous ? { ...previous, task: updatedTask } : previous));
    },
    [taskId, setDetail],
  );

  const uploadAttachment = useCallback(
    async (file: File) => {
      if (!taskId) {
        return;
      }
      const formData = new FormData();
      formData.append('file', file);

      const response = await authenticatedFetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments`, {
        method: 'POST',
        body: formData,
      });
      const body = (await response.json()) as AttachmentMutationResponse;
      if (!response.ok || !body.success || !body.data?.attachment) {
        const message = (body as { error?: { message?: string } }).error?.message;
        throw new Error(message || 'Failed to upload attachment');
      }
      const attachment = body.data.attachment;
      setDetail((previous) =>
        previous ? { ...previous, attachments: [attachment, ...previous.attachments] } : previous,
      );
    },
    [taskId, setDetail],
  );

  const deleteAttachment = useCallback(
    async (attachmentId: string) => {
      if (!taskId) {
        return;
      }
      const response = await authenticatedFetch(
        `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new Error('Failed to delete attachment');
      }
      setDetail((previous) =>
        previous
          ? { ...previous, attachments: previous.attachments.filter((a) => a.attachment_id !== attachmentId) }
          : previous,
      );
    },
    [taskId, setDetail],
  );

  const addEvidence = useCallback(
    async (kind: TaskEvidenceKind, content: string) => {
      if (!taskId) {
        return;
      }
      const response = await authenticatedFetch(`/api/tasks/${encodeURIComponent(taskId)}/evidence`, {
        method: 'POST',
        body: JSON.stringify({ kind, content }),
      });
      const body = (await response.json()) as EvidenceMutationResponse;
      if (!response.ok || !body.success || !body.data?.evidence) {
        const message = (body as { error?: { message?: string } }).error?.message;
        throw new Error(message || 'Failed to add evidence');
      }
      const evidence = body.data.evidence;
      setDetail((previous) => (previous ? { ...previous, evidence: [evidence, ...previous.evidence] } : previous));
    },
    [taskId, setDetail],
  );

  const deleteEvidence = useCallback(
    async (evidenceId: string) => {
      if (!taskId) {
        return;
      }
      const response = await authenticatedFetch(
        `/api/tasks/${encodeURIComponent(taskId)}/evidence/${encodeURIComponent(evidenceId)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new Error('Failed to delete evidence');
      }
      setDetail((previous) =>
        previous ? { ...previous, evidence: previous.evidence.filter((e) => e.evidence_id !== evidenceId) } : previous,
      );
    },
    [taskId, setDetail],
  );

  return { updateDescription, uploadAttachment, deleteAttachment, addEvidence, deleteEvidence };
}
