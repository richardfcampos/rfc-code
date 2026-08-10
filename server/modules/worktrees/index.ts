// worktreesRoutes: used by the server entrypoint to mount the complete Worktrees HTTP API at `/api/worktrees`.
export { worktreesRoutes } from './worktrees.module.js';

// `resolveWorktreeContext` is deliberately NOT re-exported here: this barrel
// pulls in the HTTP module, which reaches the projects module and back into
// providers, so a session write path importing it through this file would close
// an import cycle. Consumers import the service file directly.
