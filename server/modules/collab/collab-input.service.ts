/**
 * Validation of the one untrusted payload this module accepts: the request that
 * starts a collaboration.
 *
 * It sits apart from the service for the same reason the prompt builder does —
 * it is pure. Every round of a collaboration spends real plan quota on every
 * participating account, so the rules here are what stop a run that was always
 * going to fail (an account with no credentials, a review with three
 * reviewers, a mode nobody implements) from being discovered three paid turns
 * in. Rules that expensive deserve to be readable and testable on their own,
 * with no database and no model behind them.
 *
 * The profile lookup and the model catalog both arrive as gateways rather than
 * imports: which accounts exist, which are logged in and which models a
 * provider offers all belong elsewhere, and validation should not have to reach
 * into an account directory or a provider cache to run.
 */

import type { LLMProvider } from '@/shared/types.js';

import { badRequest } from './collab-input-errors.js';
import { assertReviewRoles, readMaxRounds, readMode } from './collab-mode-rules.js';
import { collabModelCatalog } from './collab-model-catalog.service.js';
import { readParticipantEffort, readParticipantModel } from './collab-participant-model.service.js';
import type { CollabModelCatalog } from './collab-model-catalog.service.js';
import type { CollabMode, CollabParticipant } from './collab.types.js';

const MIN_PARTICIPANTS = 2;
const MAX_PARTICIPANTS = 4;
const DEFAULT_ROLE = 'participant';

/**
 * Providers whose read-only guarantee is enforced rather than hoped for: Claude
 * by plan mode plus a deny list, Codex by an OS sandbox. The rest have none
 * wired here, and a participant free to edit the repository it is arguing about
 * is not a participant. Mixing the two in one run is fine — the provider
 * travels with the participant and picks that seat's adapter.
 */
const SUPPORTED_PROVIDERS: readonly LLMProvider[] = ['claude', 'codex'];

export interface CollabProfileSummary {
  id: string;
  name: string;
  provider: LLMProvider;
}

/** The slice of the profiles module a collaboration needs, and nothing more. */
export interface CollabProfileGateway {
  /** `null` for an unknown profile: a deleted account is a normal read state. */
  find(profileId: string): CollabProfileSummary | null;
  isAuthenticated(profileId: string): boolean;
}

export interface CreateCollaborationInput {
  topic: string;
  projectPath: string;
  mode: CollabMode;
  maxRounds: number;
  participants: CollabParticipant[];
}

function readText(value: unknown, name: string, code: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw badRequest(`${name} is required.`, code);
  return text;
}

function readParticipant(
  entry: unknown,
  seen: Set<string>,
  profiles: CollabProfileGateway,
  catalog: CollabModelCatalog,
): CollabParticipant {
  const record = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
  const profileId = readText(record.profileId, 'profileId', 'PARTICIPANT_PROFILE_ID_REQUIRED');

  if (seen.has(profileId)) {
    throw badRequest(
      `Profile "${profileId}" is listed twice; one account can only hold one seat.`,
      'DUPLICATE_PARTICIPANT',
    );
  }
  seen.add(profileId);

  const profile = profiles.find(profileId);
  if (!profile) {
    throw badRequest(
      `Profile "${profileId}" was not found; it cannot take part in a collaboration.`,
      'PARTICIPANT_PROFILE_NOT_FOUND',
    );
  }
  if (!SUPPORTED_PROVIDERS.includes(profile.provider)) {
    throw badRequest(
      `Profile "${profile.name}" runs on ${profile.provider}; collaborations currently accept ${SUPPORTED_PROVIDERS.join(' and ')} profiles only.`,
      'PARTICIPANT_PROVIDER_UNSUPPORTED',
    );
  }
  // An account with no credentials fails on its first turn and takes the whole
  // run down with it, so it is refused while refusing is still free.
  if (!profiles.isAuthenticated(profileId)) {
    throw badRequest(
      `Profile "${profile.name}" is not logged in yet; every participant must be authenticated before the run starts.`,
      'PARTICIPANT_NOT_AUTHENTICATED',
    );
  }

  const role =
    typeof record.role === 'string' && record.role.trim() ? record.role.trim() : DEFAULT_ROLE;
  const model = readParticipantModel(record.model, profile.provider, catalog);
  const effort = readParticipantEffort(record.effort, profile.provider, model, catalog);

  // Spread conditionally so an unchosen model leaves no key behind: the
  // participant list is stored as JSON and read back as the API response, and
  // an explicit `undefined` would survive the round trip as a null.
  return {
    profileId,
    provider: profile.provider,
    role,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  };
}

function readParticipants(
  value: unknown,
  mode: CollabMode,
  profiles: CollabProfileGateway,
  catalog: CollabModelCatalog,
): CollabParticipant[] {
  if (!Array.isArray(value) || value.length < MIN_PARTICIPANTS || value.length > MAX_PARTICIPANTS) {
    throw badRequest(
      `A collaboration needs between ${MIN_PARTICIPANTS} and ${MAX_PARTICIPANTS} participants.`,
      'INVALID_PARTICIPANT_COUNT',
    );
  }

  const seen = new Set<string>();
  const participants = value.map((entry) => readParticipant(entry, seen, profiles, catalog));
  if (mode === 'review') assertReviewRoles(participants);
  return participants;
}

/** Turns an untrusted request body into the exact shape the repository inserts. */
export function parseCreateCollaborationInput(
  body: unknown,
  profiles: CollabProfileGateway,
  catalog: CollabModelCatalog = collabModelCatalog,
): CreateCollaborationInput {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const mode = readMode(input.mode);

  return {
    topic: readText(input.topic, 'topic', 'TOPIC_REQUIRED'),
    projectPath: readText(input.projectPath, 'projectPath', 'PROJECT_PATH_REQUIRED'),
    mode,
    maxRounds: readMaxRounds(input.maxRounds, mode),
    participants: readParticipants(input.participants, mode, profiles, catalog),
  };
}
