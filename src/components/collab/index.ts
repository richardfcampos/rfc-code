// Public surface of the collab feature. Everything outside this folder imports
// from here, so the internal view/hook layout stays free to move.

export { default as CollabPanel } from './view/CollabPanel';
export type {
  CollabMode,
  CollabStatus,
  CollaborationDetail,
  CollaborationSummary,
  CollaborationTurn,
} from './types';
