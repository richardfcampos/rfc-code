// Public surface of the native task board feature. Everything outside this
// folder imports from here, so the internal view/hook layout stays free to move.

export { default as TaskBoardTab } from './view/TaskBoardTab';
export { useTaskBoard } from './hooks/useTaskBoard';
export type { Task, TaskOrigin, TaskStage, TaskUpdateAction, TaskUpdateEvent } from './types';
