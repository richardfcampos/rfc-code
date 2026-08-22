// tasksRoutes: used by the server entrypoint to mount the complete Tasks HTTP API at `/api/tasks`.
// tasksService: used by the agent-bridge module's MCP tools (task_create, task_list, task_update_stage, task_assign).
export { tasksRoutes, tasksService } from './tasks.module.js';

export type { TasksService } from './tasks.service.js';
export { TaskNotFoundError, TaskValidationError } from './tasks.service.js';
export type { TaskUpdateAction } from './task-update-broadcast.js';
