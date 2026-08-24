/**
 * Composition root for the Tasks module, mounted by the server entrypoint at
 * `/api/tasks`.
 *
 * Assembled here so other modules (and the agent-bridge module that consumes
 * `tasksService` directly) only ever touch this barrel, never the service or
 * route implementation files.
 */

import { createTaskDecompositionService } from '@/modules/tasks/services/task-decomposition.service.js';
import { createTaskDecompositionRouter } from '@/modules/tasks/task-decomposition.routes.js';
import { createTasksRouter } from '@/modules/tasks/tasks.routes.js';
import { createTasksService, type TasksServiceDeps } from '@/modules/tasks/tasks.service.js';

// Assignee-eligibility policy hook is injected by the composition root here;
// wired as a permissive no-op today so task assignment is unblocked before
// the org policy resolver exists. A later task swaps this binding for the
// real resolver without touching the service or routes.
const assertAssigneeAllowed: TasksServiceDeps['assertAssigneeAllowed'] = () => {};

export const tasksService = createTasksService({ assertAssigneeAllowed });

export const taskDecompositionService = createTaskDecompositionService();

const router = createTasksRouter(tasksService);
// Composed into the same router the entrypoint mounts, rather than a second
// mount point: `/api/tasks/:id/subtasks` belongs to the task it hangs off.
router.use(createTaskDecompositionRouter(taskDecompositionService));

export const tasksRoutes = router;
