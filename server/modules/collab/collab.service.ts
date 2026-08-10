/**
 * Application service for multi-account collaborations.
 *
 * It owns the read model and the lifecycle transitions the HTTP surface offers:
 * start a run, list runs, read one with its transcript, stop it, delete it.
 *
 * Rows store profile ids because an account can be renamed or deleted, while
 * the UI shows names — so names are resolved here, on read, and an account that
 * no longer exists degrades to a label instead of an error that would make a
 * whole transcript unreadable. Creation returns as soon as the row exists: a
 * collaboration is minutes of model calls, and the caller follows it by polling
 * the detail endpoint rather than holding a request open.
 *
 * The profile lookup and the engine arrive by injection, which keeps this file
 * a unit test away from any account directory or model call.
 */

import { randomUUID } from 'node:crypto';

import { AppError } from '@/shared/utils.js';

import { parseCreateCollaborationInput } from './collab-input.service.js';
import { collabRepository } from './collab.repository.js';
import { mapCollaborationRow, mapTurnRow } from './collab.types.js';
import type { CollabEngine } from './collab-engine.service.js';
import type { CollabProfileGateway } from './collab-input.service.js';
import type {
  CollabParticipant,
  CollaborationRow,
  CollaborationSummary,
  CollaborationTurn,
} from './collab.types.js';

export type {
  CollabProfileGateway,
  CollabProfileSummary,
} from './collab-input.service.js';

/** Shown instead of a name when the account behind a turn no longer exists. */
const REMOVED_PROFILE_NAME = '(profile removed)';

export type CollabParticipantView = CollabParticipant & { profileName: string };
export type CollaborationTurnView = CollaborationTurn & { profileName: string };
export type CollaborationSummaryView = Omit<CollaborationSummary, 'participants'> & {
  participants: CollabParticipantView[];
};
export type CollaborationDetailView = CollaborationSummaryView & {
  turns: CollaborationTurnView[];
};

export interface CollabServiceDeps {
  profiles: CollabProfileGateway;
  engine: CollabEngine;
  repository?: typeof collabRepository;
}

export interface CollabServices {
  create(body: unknown): CollaborationSummaryView;
  list(projectPath: unknown): CollaborationSummaryView[];
  get(id: string): CollaborationDetailView;
  stop(id: string): CollaborationSummaryView;
  remove(id: string): void;
}

type NameResolver = (profileId: string) => string;

/** One lookup per profile per response; a transcript repeats the same few ids. */
function createNameResolver(profiles: CollabProfileGateway): NameResolver {
  const cache = new Map<string, string>();
  return (profileId: string): string => {
    const cached = cache.get(profileId);
    if (cached !== undefined) return cached;

    const name = profiles.find(profileId)?.name ?? REMOVED_PROFILE_NAME;
    cache.set(profileId, name);
    return name;
  };
}

function toSummary(row: CollaborationRow, resolveName: NameResolver): CollaborationSummaryView {
  const summary = mapCollaborationRow(row);
  return {
    ...summary,
    participants: summary.participants.map((participant) => ({
      ...participant,
      profileName: resolveName(participant.profileId),
    })),
  };
}

export function createCollabService(deps: CollabServiceDeps): CollabServices {
  const repository = deps.repository ?? collabRepository;
  const { profiles, engine } = deps;

  function loadOrThrow(id: string): CollaborationRow {
    const row = repository.getById(id);
    if (!row) {
      throw new AppError(`Collaboration "${id}" was not found.`, {
        code: 'COLLABORATION_NOT_FOUND',
        statusCode: 404,
      });
    }
    return row;
  }

  return {
    create(body: unknown): CollaborationSummaryView {
      const input = parseCreateCollaborationInput(body, profiles);
      const id = randomUUID();
      const row = repository.insert({ id, ...input });

      // The caller gets the running row now: rounds cost minutes, and progress
      // is read back turn by turn from the detail endpoint.
      void engine.run(id).catch((error: unknown) => {
        console.error('[collab] collaboration run could not be started:', error);
      });

      return toSummary(row, createNameResolver(profiles));
    },

    list(projectPath: unknown): CollaborationSummaryView[] {
      const filter =
        typeof projectPath === 'string' && projectPath.trim() ? projectPath.trim() : undefined;
      const resolveName = createNameResolver(profiles);
      return repository.list(filter).map((row) => toSummary(row, resolveName));
    },

    get(id: string): CollaborationDetailView {
      const row = loadOrThrow(id);
      const resolveName = createNameResolver(profiles);
      return {
        ...toSummary(row, resolveName),
        turns: repository.listTurns(id).map((turnRow): CollaborationTurnView => {
          const turn: CollaborationTurn = mapTurnRow(turnRow);
          return { ...turn, profileName: resolveName(turn.profileId) };
        }),
      };
    },

    stop(id: string): CollaborationSummaryView {
      const row = loadOrThrow(id);
      // Only a live run can be stopped: re-stopping a finished collaboration
      // would rewrite an outcome the user already read.
      if (row.status !== 'running') {
        throw new AppError(`Collaboration "${id}" is not running (current status: ${row.status}).`, {
          code: 'COLLABORATION_NOT_RUNNING',
          statusCode: 409,
        });
      }

      const updated = repository.updateStatus(id, { status: 'stopped' }) ?? row;
      return toSummary(updated, createNameResolver(profiles));
    },

    remove(id: string): void {
      loadOrThrow(id);
      repository.deleteById(id);
    },
  };
}
