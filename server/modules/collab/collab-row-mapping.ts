/**
 * The crossing between snake_case SQLite rows and the camelCase shapes the HTTP
 * surface returns.
 *
 * It lives apart from the repository so the prompt, engine and summary tests can
 * shape rows without ever opening a connection, and apart from the type
 * declarations so neither file grows into the other's job.
 *
 * Everything here is total. A row whose JSON blob was hand-edited, truncated or
 * written by an older build must still list, still open and still delete —
 * degrading a corrupted blob to "absent" keeps a whole transcript readable,
 * while throwing would take out the page that was going to show it.
 */

import { resolveStoredBudget } from './collab-budget.js';
import type { CouncilContract } from './council-contract.js';
import type { CouncilSummary } from './council-summary.js';
import type {
  CollabParticipant,
  CollaborationRow,
  CollaborationSummary,
  CollaborationTurn,
  CollaborationTurnRow,
} from './collab.types.js';

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

/**
 * Reads a JSON column this module wrote itself. Unlike the participant blob
 * these are never hand-authored, so the shape is trusted once it parses; what
 * is not trusted is that the column holds JSON at all.
 */
function parseJsonColumn<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export function mapCollaborationRow(row: CollaborationRow): CollaborationSummary {
  const participants = parseParticipants(row.participants);

  return {
    id: row.id,
    topic: row.topic,
    mode: row.mode,
    projectPath: row.project_path,
    status: row.status,
    maxRounds: row.max_rounds,
    currentRound: row.current_round,
    participants,
    verdict: row.verdict,
    error: row.error,
    // A row written before budgets existed reports the ceiling it actually ran
    // under, which is the one derived from its own shape.
    budget: resolveStoredBudget(row.budget ?? null, {
      seats: participants.length,
      rounds: row.max_rounds,
    }),
    summary: parseJsonColumn<CouncilSummary>(row.summary ?? null),
    createdAt: normalizeSqliteTimestamp(row.created_at),
    updatedAt: normalizeSqliteTimestamp(row.updated_at),
  };
}

export function mapTurnRow(row: CollaborationTurnRow): CollaborationTurn {
  const inputTokens = row.input_tokens ?? null;
  const outputTokens = row.output_tokens ?? null;

  return {
    id: row.id,
    round: row.round,
    turnIndex: row.turn_index,
    profileId: row.profile_id,
    role: row.role,
    content: row.content,
    consensus: row.consensus === null ? null : row.consensus === 1,
    contract: parseJsonColumn<CouncilContract>(row.contract ?? null),
    contractError: row.contract_error ?? null,
    // Reported as a pair or not at all: half a measurement would read as a turn
    // that produced no output rather than one nobody metered.
    usage:
      inputTokens === null && outputTokens === null
        ? null
        : { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 },
    createdAt: normalizeSqliteTimestamp(row.created_at),
    error: row.error,
  };
}
