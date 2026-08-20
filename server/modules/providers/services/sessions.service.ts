import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionLegsDb, sessionRunFailuresDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { profilesService } from '@/modules/profiles/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { fetchUnifiedHistory } from '@/modules/providers/services/session-history-merge.js';
import { resolveWorktreeContext } from '@/modules/repo-context/index.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type CreateAppSessionResult = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
  /** The bound account, which may be the provider default the caller omitted. */
  profileId: string | null;
};

type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
  worktreePath: string | null;
  worktreeBranch: string | null;
};

/**
 * Removes one file if it exists.
 */
async function removeFileIfExists(filePath: string): Promise<boolean> {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Archive rows need a stable project label even when the owning project is not
 * part of the active sidebar payload. This lightweight resolver keeps the
 * archive API self-contained while still matching the project's stored display
 * name when one exists.
 */
function resolveProjectDisplayName(
  projectPath: string | null,
  customProjectName: string | null | undefined,
): string {
  const trimmedCustomName = typeof customProjectName === 'string' ? customProjectName.trim() : '';
  if (trimmedCustomName.length > 0) {
    return trimmedCustomName;
  }

  if (!projectPath) {
    return 'Unknown Project';
  }

  return path.basename(projectPath) || projectPath;
}

/**
 * Merges this session's recorded run failures into a history page.
 *
 * Pagination here walks backwards from the end, and a failure always belongs
 * to the tail of the conversation, so failures are only merged into the tail
 * page (`offset === 0`). Older pages are pure transcript.
 *
 * Each failure lands at its own position in time rather than at the end of the
 * page: a session that failed once and then recovered keeps talking, and
 * appending would park that old error below every later message, making a
 * resolved failure look like the newest thing that happened. Only the failures
 * are placed — transcript messages keep the order the adapter returned, since
 * not all of them carry a comparable timestamp.
 *
 * They are emitted as ordinary `error` messages, which is exactly what the
 * client already renders for a live failure — the difference is that these
 * survive a reload, a closed tab, and the five-minute replay buffer.
 */
function withRunFailures(
  result: FetchHistoryResult,
  sessionId: string,
  provider: LLMProvider,
  requestedOffset: number,
): FetchHistoryResult {
  // The requested offset decides this, not the one the adapter echoed back:
  // adapters are free to report their own paging metadata, and trusting it
  // would append failures onto an older page.
  if (requestedOffset !== 0) {
    return result;
  }

  const failures = sessionRunFailuresDb.listBySession(sessionId);
  if (failures.length === 0) {
    return result;
  }

  const failureMessages: NormalizedMessage[] = failures.map((failure) => ({
    id: `run_failure_${failure.failure_id}`,
    sessionId,
    provider: (failure.provider || provider) as LLMProvider,
    kind: 'error',
    content: failure.error_message,
    timestamp: failure.failed_at,
  }));

  // Failures arrive oldest first, so one forward pass over the transcript
  // places them all: each is inserted before the first later message that has
  // a usable timestamp. A failure newer than everything on the page — or a
  // page whose messages carry no parseable timestamps at all — still ends up
  // at the tail, which is the old behavior.
  const merged: NormalizedMessage[] = [];
  let nextFailure = 0;

  for (const message of result.messages) {
    const messageTime = toEpoch(message.timestamp);
    while (
      nextFailure < failureMessages.length
      && messageTime !== null
      && messageTime > toEpoch(failureMessages[nextFailure].timestamp)!
    ) {
      merged.push(failureMessages[nextFailure]);
      nextFailure += 1;
    }
    merged.push(message);
  }

  merged.push(...failureMessages.slice(nextFailure));

  return {
    ...result,
    messages: merged,
    total: result.total + failureMessages.length,
  };
}

/** Milliseconds for a message timestamp, or null when it cannot be compared. */
function toEpoch(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Application service for provider-backed session message operations.
 *
 * Callers pass a provider id and this service resolves the concrete provider
 * class, keeping normalization/history call sites decoupled from implementation
 * file layout.
 */
export const sessionsService = {
  /**
   * Lists provider ids that can load session history and normalize live messages.
   */
  listProviderIds(): LLMProvider[] {
    return providerRegistry.listProviders().map((provider) => provider.id);
  },

  /**
   * Returns app-facing ids for provider runs that are currently processing.
   *
   * This is intentionally status-only: callers that only need sidebar activity
   * indicators should not attach to chat streams or request replayed messages.
   */
  listRunningSessions(): Array<{
    sessionId: string;
    provider: LLMProvider;
    startedAt: number;
    lastSeq: number;
  }> {
    return chatRunRegistry.listRunningRuns();
  },

  /**
   * Normalizes one provider-native event into frontend session message events.
   */
  normalizeMessage(
    providerName: string,
    raw: unknown,
    sessionId: string | null,
  ): NormalizedMessage[] {
    return providerRegistry.resolveProvider(providerName).sessions.normalizeMessage(raw, sessionId);
  },

  /**
   * Allocates a stable app-facing session id before any provider run happens.
   *
   * This is the entry point of the session gateway: the frontend calls this
   * (via `POST /api/providers/sessions`) when the user starts a brand-new
   * chat, navigates to the returned id immediately, and the id never changes
   * for the lifetime of the conversation. The provider-native id is mapped to
   * this row later, when the provider runtime announces it mid-run.
   *
   * An optional `profileId` binds the session to one account profile from
   * creation (HUB-05 AC2): it is validated against the profile registry so a
   * dangling id fails loudly here rather than silently persisting a ghost
   * reference the UI can never resolve to a name. Omitting it falls back to
   * the provider's default profile, if the user nominated one.
   *
   * The caller-supplied `projectPath` is treated as the desired cwd, which
   * may point inside a worktree — the frontend no longer decides which
   * project a session groups under. `resolveWorktreeContext` derives the
   * owning repository root and, when the cwd is a secondary worktree, the
   * worktree path/branch to persist alongside the row. A plain directory
   * resolves to itself, so existing behavior is unchanged for non-worktree
   * projects. `resolveContext` is injectable so callers (tests) can avoid
   * shelling out to git.
   */
  async createAppSession(
    provider: LLMProvider,
    projectPath: string,
    profileId?: string | null,
    resolveContext: typeof resolveWorktreeContext = resolveWorktreeContext,
  ): Promise<CreateAppSessionResult> {
    const normalizedProjectPath = projectPath.trim();
    if (!normalizedProjectPath) {
      throw new AppError('projectPath is required.', {
        code: 'PROJECT_PATH_REQUIRED',
        statusCode: 400,
      });
    }

    if (profileId) {
      // Throws a 404 AppError for an unknown profile id (loadProfileOrThrow).
      profilesService.getProfile(profileId);
    }

    // Only a session being created without a pick falls back to the provider's
    // default account. Sessions already stored with a NULL profile_id keep
    // running on the CLI's own config directory: they were started against
    // those credentials, and re-pointing them at another account retroactively
    // would change which account answers an ongoing conversation.
    const resolvedProfileId = profileId ?? profilesService.resolveDefaultProfileId(provider);

    const context = await resolveContext(normalizedProjectPath);
    const sessionId = randomUUID();
    sessionsDb.createAppSession(
      sessionId,
      provider,
      context.projectPath,
      resolvedProfileId,
      context.worktreePath,
      context.worktreeBranch,
    );

    return {
      sessionId,
      provider,
      // Reflects the resolved repository root, not the cwd the caller sent.
      projectPath: context.projectPath,
      profileId: resolvedProfileId,
    };
  },

  /**
   * Fetches persisted history by app session id.
   *
   * Provider and provider-specific lookup hints are resolved from the indexed
   * session metadata in the database. The provider adapter receives the
   * provider-native session id (the one written into transcripts on disk),
   * and every returned message is remapped back to the app session id so
   * provider ids never reach the frontend.
   */
  async fetchHistory(
    sessionId: string,
    options: Pick<FetchHistoryOptions, 'limit' | 'offset'> = {},
  ): Promise<FetchHistoryResult> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    // App-created sessions that never produced a provider transcript yet
    // (e.g. first message still streaming) simply have no history — but a run
    // that died before writing anything (not logged in, plan limit) still has
    // a failure worth showing, and it is the only record of that attempt.
    if (!session.provider_session_id) {
      return withRunFailures(
        {
          messages: [],
          total: 0,
          hasMore: false,
          offset: options.offset ?? 0,
          limit: options.limit ?? null,
        },
        session.session_id,
        session.provider as LLMProvider,
        options.offset ?? 0,
      );
    }

    const legs = sessionLegsDb.listLegs(session.session_id);

    let result: FetchHistoryResult;
    if (legs.length >= 2) {
      result = await fetchUnifiedHistory(
        { session_id: session.session_id, project_path: session.project_path },
        legs,
        { limit: options.limit ?? null, offset: options.offset ?? 0 },
      );
    } else {
      const provider = session.provider as LLMProvider;
      result = await providerRegistry.resolveProvider(provider).sessions.fetchHistory(sessionId, {
        limit: options.limit ?? null,
        offset: options.offset ?? 0,
        projectPath: session.project_path ?? '',
        providerSessionId: session.provider_session_id,
      });
    }

    return withRunFailures(
      {
        ...result,
        messages: result.messages.map((message) => ({
          ...message,
          sessionId,
        })),
      },
      sessionId,
      session.provider as LLMProvider,
      options.offset ?? 0,
    );
  },

  /**
   * Returns archived sessions with enough project metadata for the sidebar to
   * group, filter, open, and restore them without a per-row follow-up query.
   */
  listArchivedSessions(): ArchivedSessionListItem[] {
    const archivedSessions = sessionsDb.getArchivedSessions();
    const projectCache = new Map<string, ReturnType<typeof projectsDb.getProjectPath>>();

    return archivedSessions.map((session) => {
      const projectPath = session.project_path?.trim() ? session.project_path : null;
      let project = null;

      if (projectPath) {
        if (!projectCache.has(projectPath)) {
          projectCache.set(projectPath, projectsDb.getProjectPath(projectPath));
        }
        project = projectCache.get(projectPath) ?? null;
      }

      return {
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        projectId: project?.project_id ?? null,
        projectPath,
        projectDisplayName: resolveProjectDisplayName(projectPath, project?.custom_project_name),
        sessionTitle: session.custom_name?.trim() || session.session_id,
        createdAt: session.created_at ?? null,
        updatedAt: session.updated_at ?? null,
        lastActivity: session.updated_at ?? session.created_at ?? null,
        isProjectArchived: Boolean(project?.isArchived),
        worktreePath: session.worktree_path ?? null,
        worktreeBranch: session.worktree_branch ?? null,
      };
    });
  },

  /**
   * Archives or permanently deletes one persisted session row by id.
   *
   * Soft-delete mirrors the project behavior by toggling `isArchived` so the
   * row disappears from active lists but remains restorable. Force-delete
   * optionally removes the transcript file before deleting the database row.
   */
  async deleteOrArchiveSessionById(
    sessionId: string,
    options: {
      force?: boolean;
      deletedFromDisk?: boolean;
    } = {},
  ): Promise<{ sessionId: string; action: 'archived' | 'deleted'; deletedFromDisk: boolean }> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!options.force) {
      sessionsDb.updateSessionIsArchived(sessionId, true);
      return {
        sessionId,
        action: 'archived',
        deletedFromDisk: false,
      };
    }

    let removedFromDisk = false;
    if (options.deletedFromDisk && session.jsonl_path) {
      removedFromDisk = await removeFileIfExists(session.jsonl_path);
    }

    const deleted = sessionsDb.deleteSessionById(sessionId);
    if (!deleted) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionRunFailuresDb.deleteBySession(sessionId);

    return {
      sessionId,
      action: 'deleted',
      deletedFromDisk: removedFromDisk,
    };
  },

  /**
   * Restores one archived session back into the active sidebar lists.
   */
  restoreSessionById(sessionId: string): { sessionId: string; isArchived: false } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionIsArchived(sessionId, false);
    return { sessionId, isArchived: false };
  },

  /**
   * Renames one session by id without requiring the caller to pass provider.
   */
  renameSessionById(sessionId: string, summary: string): { sessionId: string; summary: string } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionCustomName(sessionId, summary);
    return { sessionId, summary };
  },
};
