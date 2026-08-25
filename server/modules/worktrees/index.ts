// worktreesRoutes: used by the server entrypoint to mount the complete Worktrees HTTP API at `/api/worktrees`.
export { worktreesRoutes } from './worktrees.module.js';

// The repository's own view of its worktrees, plus the merge workflow. The
// Review Center matches a task's branch against this listing (so every git
// argument it passes is one git itself reported) and lands an approved review
// through the same merge service the HTTP API uses.
export {
  findWorktreeEntryByPath,
  listWorktreePorcelainEntries,
  validateWorktreeBranchName,
} from './services/worktree-git.service.js';
export { createWorktree } from './services/worktree-create.service.js';
export { mergeWorktree } from './services/worktree-merge.service.js';
export { removeWorktree } from './services/worktree-remove.service.js';

// `resolveWorktreeContext` is deliberately NOT re-exported here: this barrel
// pulls in the HTTP module, which reaches the projects module and back into
// providers, so a session write path importing it through this file would close
// an import cycle. Consumers import the service file directly.
