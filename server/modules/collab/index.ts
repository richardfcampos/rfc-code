/**
 * Public surface of the collaboration module: what the server entrypoint mounts
 * and calls at boot, and nothing else.
 *
 * The routes, the engine and the repository are deliberately not re-exported.
 * A collaboration is started over HTTP and read over HTTP; anything reaching
 * further in would couple another module to a round loop that only the
 * composition root is allowed to assemble.
 */

export {
  // Mounted at `/api/collaborations`.
  collabRoutes,
  // The entrypoint owns the Claude SDK import and hands it over at boot.
  configureCollabClaudeRuntime,
  // Boot sweep: runs the dead process left behind are closed as failures.
  failOrphanedCollaborations,
} from './collab.module.js';
export type { CollabClaudeRuntimeDeps } from './collab.module.js';
