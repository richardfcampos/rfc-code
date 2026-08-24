// tasksRoutes: used by the server entrypoint to mount the complete Tasks HTTP API at `/api/tasks`.
// tasksService: used by the agent-bridge module's MCP tools (task_create, task_list, task_update_stage, task_assign).
// taskDecompositionService: used by the agent-bridge module's maestro tools
// (task_decompose, task_ready_list).
export { taskDecompositionService, tasksRoutes, tasksService } from './tasks.module.js';

export type {
  TaskDecomposition,
  TaskDecompositionService,
} from './services/task-decomposition.service.js';
export type { TasksService } from './tasks.service.js';
export { TaskNotFoundError, TaskValidationError } from './tasks.service.js';
// broadcastTaskUpdate: used by the agent-bridge module so a task an agent
// mutates reaches open boards exactly like one mutated through the REST API.
export { broadcastTaskUpdate } from './task-update-broadcast.js';
export type { TaskUpdateAction } from './task-update-broadcast.js';
