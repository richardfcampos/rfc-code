// Frontend mirror of the collaboration API contract: two or more account
// profiles debating a topic until a verdict. Kept in one place so the panel,
// the detail view and the create modal agree on the shape the server returns.

import { DEFAULT_EFFORT_VALUE } from '../chat/constants/providerEffort';
import type { LLMProvider } from '../../types/app';

import type { CouncilContract, CouncilSummary } from './council-types';

// `council` is the generalized mode: participants answer under the
// evidence/risk/test/disagreement/confidence contract, and the run ends with a
// computed summary. The other three predate it and keep their own
// prose-and-consensus protocol untouched.
export const COLLAB_MODES = ['debate', 'review', 'vote', 'council'] as const;
export type CollabMode = (typeof COLLAB_MODES)[number];

export const COLLAB_STATUSES = ['running', 'converged', 'exhausted', 'stopped', 'failed'] as const;
export type CollabStatus = (typeof COLLAB_STATUSES)[number];

// Participant roles are free-form on the wire (`review` uses author/reviewer,
// the other modes leave everyone as a plain participant).
export const REVIEW_ROLES = ['author', 'reviewer'] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];

export interface CollabParticipant {
  profileId: string;
  profileName: string;
  provider: LLMProvider;
  role: string;
  // Absent when the seat made no choice: that turn runs on whatever the
  // provider's CLI defaults to, which is what every collaboration did before
  // seats could pick.
  model?: string;
  effort?: string;
}

export interface CollaborationSummary {
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
  // Computed from the stored council contracts when the run ends; null while it
  // is still going, and on every run of the three modes that carry no contract.
  summary: CouncilSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollaborationTurn {
  id: string;
  round: number;
  turnIndex: number;
  profileId: string;
  profileName: string;
  role: 'participant' | 'arbiter';
  content: string;
  // null means the turn carried no parsable consensus signal, which is not the
  // same as an explicit "no".
  consensus: boolean | null;
  // The council contract this turn stated. null on every non-council turn and
  // on a council turn that answered with nothing parsable — `content` always
  // holds the raw answer either way.
  contract: CouncilContract | null;
  // Why the contract could not be read in full, when it could not.
  contractError: string | null;
  error: string | null;
  createdAt: string;
}

export interface CollaborationDetail extends CollaborationSummary {
  turns: CollaborationTurn[];
}

export interface CreateCollaborationParticipant {
  profileId: string;
  role?: string;
  model?: string;
  effort?: string;
}

/**
 * What one seat picked in the create form. Both fields always hold a value so
 * the menu has something to render; the sentinels below are what mean "send
 * nothing and let the CLI decide".
 */
export interface CollabParticipantSettings {
  model: string;
  effort: string;
}

/**
 * The empty string rather than a made-up id: a sentinel like `"__default__"`
 * could one day collide with a real model a provider starts shipping, and
 * nothing a catalog returns is ever empty.
 */
export const PROVIDER_DEFAULT_MODEL = '';

export const DEFAULT_PARTICIPANT_SETTINGS: CollabParticipantSettings = {
  model: PROVIDER_DEFAULT_MODEL,
  effort: DEFAULT_EFFORT_VALUE,
};

export interface CreateCollaborationInput {
  topic: string;
  projectPath: string;
  mode: CollabMode;
  participants: CreateCollaborationParticipant[];
  maxRounds: number;
}

/** Minimal profile shape the participant picker needs from `/api/profiles`. */
export interface CollabProfileOption {
  id: string;
  name: string;
  provider: LLMProvider;
}

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 4;
export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 5;
export const DEFAULT_MAX_ROUNDS = 3;

/** Only `running` keeps working; every other status is final, so polling stops. */
export const isTerminalStatus = (status: CollabStatus): boolean => status !== 'running';
