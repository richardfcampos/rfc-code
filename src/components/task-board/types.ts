// Frontend mirror of the server's `TaskRow` (server/modules/database/repositories/tasks.db.ts)
// and the `task_update` WS envelope (server/modules/tasks/task-update-broadcast.ts). The
// frontend keeps its own copy of server contracts instead of importing server modules —
// same convention as `ProfileUsageSnapshot` in `components/profiles/types.ts`.

export type TaskStage = 'backlog' | 'in_progress' | 'review' | 'done';
export type TaskOrigin = 'user' | 'agent' | 'automation';

export const TASK_STAGES: readonly TaskStage[] = ['backlog', 'in_progress', 'review', 'done'];

export interface Task {
  id: string;
  project_name: string;
  title: string;
  description: string | null;
  stage: TaskStage;
  origin: TaskOrigin;
  origin_detail: string | null;
  assignee_profile_id: string | null;
  suggested_skill: string | null;
  worktree_branch: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskUpdateAction = 'created' | 'updated' | 'deleted';

/** Shape of the `task_update` WS frame broadcast by `broadcastTaskUpdate`. */
export interface TaskUpdateEvent {
  kind: 'task_update';
  action: TaskUpdateAction;
  task: Task;
}

// Mirrors `server/modules/database/repositories/task-attachments.db.ts` and
// `task-evidence.db.ts` — same "frontend keeps its own copy" convention as `Task` above.

export interface TaskAttachment {
  attachment_id: string;
  task_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  stored_path: string;
  created_at: string;
}

export type TaskEvidenceKind = 'note' | 'link' | 'attachment';

export interface TaskEvidence {
  evidence_id: string;
  task_id: string;
  kind: TaskEvidenceKind;
  content: string;
  attachment_id: string | null;
  created_at: string;
}

/** Response body of `GET /api/tasks/:id` — the task plus its rich fields. */
export interface TaskDetail {
  task: Task;
  attachments: TaskAttachment[];
  evidence: TaskEvidence[];
}

// Frontend mirror of the automations REST view
// (server/modules/automations/automations.types.ts `AutomationView`).
export interface AutomationView {
  automationId: string;
  name: string;
  enabled: boolean;
  triggerKind: string;
  triggerConfig: Record<string, unknown>;
  actionKind: string;
  actionConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
