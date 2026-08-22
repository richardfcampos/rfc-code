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
