/**
 * Contracts shared by the collaboration repository, engine and routes.
 *
 * Database rows are snake_case mirrors of SQLite columns while the HTTP
 * surface is camelCase, so something has to own that crossing. It lives here,
 * as pure functions, rather than in the repository: the service layer enriches
 * participants and turns with profile names it resolves elsewhere, and the
 * prompt/engine tests need to shape rows without ever opening a connection.
 */

import type { LLMProvider } from '@/shared/types.js';

export type CollabMode = 'debate' | 'review' | 'vote';

export type CollabStatus = 'running' | 'converged' | 'exhausted' | 'stopped' | 'failed';

export type CollabTurnRole = 'participant' | 'arbiter';

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
};

export type CollaborationStatusPatch = {
  status: CollabStatus;
  verdict?: string | null;
  error?: string | null;
  currentRound?: number;
};

const SQLITE_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * SQLite writes CURRENT_TIMESTAMP as UTC without a timezone suffix, which the
 * browser would otherwise read as local time and render as hours-old rows.
 * Every timestamp leaving this module is canonical ISO.
 */
export function normalizeSqliteTimestamp(value: string): string {
  if (!value) return value;

  const candidate = SQLITE_UTC_TIMESTAMP_REGEX.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = new Date(candidate);

  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * Rebuilds one participant field by field rather than trusting the blob it came
 * from. The optional model and effort are dropped when they are not text, so a
 * hand-edited row cannot put a number where a provider expects a model id — and
 * the key stays absent rather than present-and-undefined, which is what keeps
 * the JSON round trip and the API response identical to what was written.
 */
function toParticipant(value: unknown): CollabParticipant | null {
  const candidate = value as Partial<CollabParticipant> | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.profileId !== 'string' ||
    typeof candidate.provider !== 'string' ||
    typeof candidate.role !== 'string'
  ) {
    return null;
  }

  const participant: CollabParticipant = {
    profileId: candidate.profileId,
    provider: candidate.provider,
    role: candidate.role,
  };
  if (typeof candidate.model === 'string' && candidate.model) participant.model = candidate.model;
  if (typeof candidate.effort === 'string' && candidate.effort) participant.effort = candidate.effort;
  return participant;
}

/**
 * Participants are stored as a JSON blob. A collaboration whose blob got
 * corrupted must still be readable and deletable, so malformed content
 * degrades to an empty list instead of throwing on the read path.
 */
export function parseParticipants(raw: string): CollabParticipant[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(toParticipant)
      .filter((participant): participant is CollabParticipant => participant !== null);
  } catch {
    return [];
  }
}

export function mapCollaborationRow(row: CollaborationRow): CollaborationSummary {
  return {
    id: row.id,
    topic: row.topic,
    mode: row.mode,
    projectPath: row.project_path,
    status: row.status,
    maxRounds: row.max_rounds,
    currentRound: row.current_round,
    participants: parseParticipants(row.participants),
    verdict: row.verdict,
    error: row.error,
    createdAt: normalizeSqliteTimestamp(row.created_at),
    updatedAt: normalizeSqliteTimestamp(row.updated_at),
  };
}

export function mapTurnRow(row: CollaborationTurnRow): CollaborationTurn {
  return {
    id: row.id,
    round: row.round,
    turnIndex: row.turn_index,
    profileId: row.profile_id,
    role: row.role,
    content: row.content,
    consensus: row.consensus === null ? null : row.consensus === 1,
    createdAt: normalizeSqliteTimestamp(row.created_at),
    error: row.error,
  };
}
