/**
 * Contracts shared by the collaboration repository, engine and routes.
 *
 * Database rows are snake_case mirrors of SQLite columns while the HTTP surface
 * is camelCase, so something has to own that crossing: the functions that do it
 * live in `collab-row-mapping.ts` and are re-exported here, which keeps this
 * file a list of shapes and every existing import unchanged.
 *
 * The council fields — the per-turn contract, the run's budget and its computed
 * summary — are additive everywhere they appear. A row that predates them is a
 * row where they are absent, never a row that fails to load.
 */

import type { LLMProvider } from '@/shared/types.js';

import type { CouncilBudget } from './collab-budget.js';
import type { CouncilContract } from './council-contract.js';
import type { CouncilSummary } from './council-summary.js';

export {
  mapCollaborationRow,
  mapTurnRow,
  normalizeSqliteTimestamp,
  parseParticipants,
} from './collab-row-mapping.js';

/**
 * `council` is the generalized mode: participants answer under the
 * evidence/risk/test/disagreement/confidence contract. The other three predate
 * it and keep their own prose-and-consensus protocol untouched.
 */
export type CollabMode = 'debate' | 'review' | 'vote' | 'council';

export type CollabStatus = 'running' | 'converged' | 'exhausted' | 'stopped' | 'failed';

export type CollabTurnRole = 'participant' | 'arbiter';

/** What one turn actually cost, when the provider adapter reports it. */
export interface CollabTurnUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * One account taking part in a collaboration. `role` is mode-dependent
 * (`author`/`reviewer` in review mode, `participant` otherwise) so it stays a
 * free-form string instead of a union the modes would keep fighting over.
 */
export type CollabParticipant = {
  profileId: string;
  provider: LLMProvider;
  role: string;
  /**
   * Model id from the participant's own provider catalog. Optional on purpose:
   * an account that picks nothing runs on whatever its CLI defaults to, which
   * is what every collaboration did before seats could choose.
   */
  model?: string;
  /** Reasoning effort valid for `model`; omitted leaves the CLI's own default. */
  effort?: string;
};

/** Row of `collaborations`, mirroring the columns one for one. */
export type CollaborationRow = {
  id: string;
  topic: string;
  mode: CollabMode;
  project_path: string;
  status: CollabStatus;
  max_rounds: number;
  current_round: number;
  /** JSON-encoded `CollabParticipant[]`. */
  participants: string;
  verdict: string | null;
  error: string | null;
  /** JSON-encoded `CouncilBudget`; NULL on rows written before budgets. */
  budget: string | null;
  /** JSON-encoded `CouncilSummary`; NULL until the run ends. */
  summary: string | null;
  created_at: string;
  updated_at: string;
};

/** Row of `collaboration_turns`, mirroring the columns one for one. */
export type CollaborationTurnRow = {
  id: string;
  collaboration_id: string;
  round: number;
  turn_index: number;
  profile_id: string;
  role: CollabTurnRole;
  content: string;
  /** 1 yes, 0 no, NULL when the mode or the turn does not vote. */
  consensus: number | null;
  error: string | null;
  /** JSON-encoded `CouncilContract`; NULL when the turn carried none. */
  contract: string | null;
  contract_error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
};

export type CollaborationSummary = {
  id: string;
  topic: string;
  mode: CollabMode;
  projectPath: string;
  status: CollabStatus;
  maxRounds: number;
  currentRound: number;
  participants: CollabParticipant[];
  verdict: string | null;
  error: string | null;
  /** Always present on read: a stored NULL resolves to the run's own defaults. */
  budget: CouncilBudget;
  summary: CouncilSummary | null;
  createdAt: string;
  updatedAt: string;
};

export type CollaborationTurn = {
  id: string;
  round: number;
  turnIndex: number;
  profileId: string;
  role: CollabTurnRole;
  content: string;
  consensus: boolean | null;
  contract: CouncilContract | null;
  /** Why the contract could not be read in full; the raw answer is `content`. */
  contractError: string | null;
  usage: CollabTurnUsage | null;
  error: string | null;
  createdAt: string;
};

export type CollaborationDetail = CollaborationSummary & { turns: CollaborationTurn[] };

/** Write contracts. Camel-cased like the callers; the repository does the mapping. */
export type InsertCollaborationInput = {
  id: string;
  topic: string;
  mode: CollabMode;
  projectPath: string;
  maxRounds: number;
  participants: CollabParticipant[];
  /** Omitted leaves the column NULL, which reads back as the run's defaults. */
  budget?: CouncilBudget;
  /** Defaults to `running`: a row only exists because a run just started. */
  status?: CollabStatus;
  currentRound?: number;
};

export type AppendTurnInput = {
  id: string;
  collaborationId: string;
  round: number;
  turnIndex: number;
  profileId: string;
  role: CollabTurnRole;
  content: string;
  consensus?: boolean | null;
  error?: string | null;
  contract?: CouncilContract | null;
  contractError?: string | null;
  usage?: CollabTurnUsage | null;
};

export type CollaborationStatusPatch = {
  status: CollabStatus;
  verdict?: string | null;
  error?: string | null;
  currentRound?: number;
  summary?: CouncilSummary | null;
};
