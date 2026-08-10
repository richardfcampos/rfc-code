// Repository-context resolution: answers "which repository does this working
// directory belong to, and is it a secondary worktree?". Every session write
// path goes through it, which is why it is a module of its own instead of part
// of the worktrees HTTP module — depending on that module here would close an
// import cycle back into providers.
export {
  __resetWorktreeContextCache,
  resolveWorktreeContext,
} from './services/worktree-context.service.js';
export type { WorktreeContext } from './services/worktree-context.service.js';
export { runWorktreeSessionBackfill } from './services/worktree-session-backfill.service.js';
export type {
  WorktreeSessionBackfillDependencies,
  WorktreeSessionBackfillSummary,
} from './services/worktree-session-backfill.service.js';
