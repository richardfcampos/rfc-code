export {
  generateDisplayName,
  getProjectsWithSessions,
} from './services/projects-with-sessions-fetch.service.js';
export { getProjectsCompact } from './services/projects-compact-list.service.js';
export type { CompactProjectListItem } from './services/projects-compact-list.service.js';
export { createProject, updateProjectDisplayName } from './services/project-management.service.js';
export { startWorktreeCodegraphIndex } from './services/project-codegraph.service.js';
export {
  deleteOrArchiveProject,
  deleteSessionJsonlFilesForProjectPath,
  restoreArchivedProject,
} from './services/project-delete.service.js';
