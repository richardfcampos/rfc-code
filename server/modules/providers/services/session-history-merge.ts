import type { LegRow } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { FetchHistoryResult, LLMProvider, NormalizedMessage } from '@/shared/types.js';
import { sliceTailPage } from '@/shared/utils.js';

export type UnifiedHistorySession = {
  session_id: string;
  project_path: string | null;
};

export type UnifiedHistoryOptions = {
  limit: number | null;
  offset: number;
};

/**
 * Loads one leg's full message list. Injectable so tests can drive the merge
 * without a real provider transcript on disk.
 */
export type LegHistoryFetcher = (
  session: UnifiedHistorySession,
  leg: LegRow,
) => Promise<FetchHistoryResult>;

const SQLITE_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Leg rows carry SQLite's `CURRENT_TIMESTAMP` (UTC, no timezone suffix) while
 * provider messages carry ISO strings. Parsing the former without the suffix
 * would read it as local time and drag boundary markers hours away from the
 * messages they belong to.
 */
function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = SQLITE_UTC_TIMESTAMP_REGEX.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function fetchLegHistoryFromRegistry(
  session: UnifiedHistorySession,
  leg: LegRow,
): Promise<FetchHistoryResult> {
  return providerRegistry.resolveProvider(leg.provider).sessions.fetchHistory(session.session_id, {
    limit: null,
    offset: 0,
    projectPath: session.project_path ?? '',
    providerSessionId: leg.provider_session_id ?? undefined,
  });
}

function buildSwitchMarker(session: UnifiedHistorySession, leg: LegRow): NormalizedMessage {
  return {
    id: `leg-marker-${leg.leg_id}`,
    sessionId: session.session_id,
    timestamp: leg.started_at,
    provider: leg.provider as LLMProvider,
    kind: 'provider_switch',
    switchProvider: leg.provider as LLMProvider,
    switchProfileName: leg.profile_name_at_switch ?? undefined,
  };
}

function buildErrorMarker(session: UnifiedHistorySession, leg: LegRow): NormalizedMessage {
  return {
    id: `leg-error-${leg.leg_id}`,
    sessionId: session.session_id,
    timestamp: leg.started_at,
    provider: leg.provider as LLMProvider,
    kind: 'error',
    isError: true,
    content: `Could not load the ${leg.provider} part of this conversation.`,
  };
}

type TimelineEntry = {
  message: NormalizedMessage;
  time: number;
  legIndex: number;
  orderInLeg: number;
};

function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
  if (a.time !== b.time) {
    return a.time - b.time;
  }
  if (a.legIndex !== b.legIndex) {
    return a.legIndex - b.legIndex;
  }
  return a.orderInLeg - b.orderInLeg;
}

/**
 * Renders every leg of one app session as a single chronological timeline.
 *
 * Legs are merged by real timestamp rather than concatenated in `seq` order:
 * a user who switches A -> B -> A resumes the first leg, so that leg's later
 * messages must land after leg B's, not lumped with the messages it started
 * with.
 *
 * Messages keep the `sessionId` their adapter returned — remapping to the
 * app-facing id happens once in the calling service, uniformly for one-leg and
 * multi-leg sessions.
 */
export async function fetchUnifiedHistory(
  session: UnifiedHistorySession,
  legs: LegRow[],
  options: UnifiedHistoryOptions,
  fetchLegHistory: LegHistoryFetcher = fetchLegHistoryFromRegistry,
): Promise<FetchHistoryResult> {
  // A leg that never produced a turn (two switches in a row) has nothing to
  // read and no boundary worth showing.
  const loadableLegs = legs
    .map((leg, legIndex) => ({ leg, legIndex }))
    .filter(({ leg }) => Boolean(leg.provider_session_id));

  const results = await Promise.allSettled(
    loadableLegs.map(({ leg }) => fetchLegHistory(session, leg)),
  );

  const entries: TimelineEntry[] = [];

  loadableLegs.forEach(({ leg, legIndex }, index) => {
    const result = results[index];
    const legStartTime = parseTimestamp(leg.started_at) ?? 0;
    let orderInLeg = 0;

    const push = (message: NormalizedMessage, time: number): void => {
      entries.push({ message, time, legIndex, orderInLeg });
      orderInLeg += 1;
    };

    if (legIndex > 0) {
      push(buildSwitchMarker(session, leg), legStartTime);
    }

    if (result.status === 'rejected') {
      // One unreadable leg must not blank out the whole conversation.
      push(buildErrorMarker(session, leg), legStartTime);
      return;
    }

    // A message with a broken timestamp keeps its neighbour's position instead
    // of collapsing to the epoch and jumping to the top of the timeline.
    let lastKnownTime = legStartTime;
    for (const message of result.value.messages) {
      lastKnownTime = parseTimestamp(message.timestamp) ?? lastKnownTime;
      push(message, lastKnownTime);
    }
  });

  entries.sort(compareEntries);
  const merged = entries.map((entry) => entry.message);

  const normalizedOffset = Math.max(0, options.offset);
  const normalizedLimit = options.limit === null ? null : Math.max(0, options.limit);
  const { page, hasMore } = sliceTailPage(merged, normalizedLimit, normalizedOffset);

  return {
    messages: page,
    total: merged.length,
    hasMore,
    offset: normalizedOffset,
    limit: normalizedLimit,
  };
}
