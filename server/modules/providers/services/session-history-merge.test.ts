import assert from 'node:assert/strict';
import test from 'node:test';

import type { LegRow } from '@/modules/database/index.js';
import {
  fetchUnifiedHistory,
  type LegHistoryFetcher,
  type UnifiedHistorySession,
} from '@/modules/providers/services/session-history-merge.js';
import type { FetchHistoryResult, LLMProvider, NormalizedMessage } from '@/shared/types.js';

const SESSION: UnifiedHistorySession = {
  session_id: 'app-session-1',
  project_path: '/workspace/demo',
};

function buildLeg(overrides: Partial<LegRow> & Pick<LegRow, 'leg_id' | 'seq' | 'provider'>): LegRow {
  return {
    session_id: SESSION.session_id,
    profile_id: null,
    provider_session_id: `provider-${overrides.leg_id}`,
    jsonl_path: null,
    profile_name_at_switch: null,
    started_at: '2026-01-01T00:00:00.000Z',
    ended_at: null,
    ...overrides,
  };
}

function buildMessage(id: string, timestamp: string, provider: LLMProvider): NormalizedMessage {
  return {
    id,
    sessionId: `provider-native-${provider}`,
    timestamp,
    provider,
    kind: 'text',
    role: 'assistant',
    content: id,
  };
}

function fetcherFor(
  messagesByLegId: Record<string, NormalizedMessage[]>,
  failingLegIds: string[] = [],
): LegHistoryFetcher {
  return async (_session, leg): Promise<FetchHistoryResult> => {
    if (failingLegIds.includes(leg.leg_id)) {
      throw new Error('transcript unreadable');
    }

    const messages = messagesByLegId[leg.leg_id] ?? [];
    return {
      messages,
      total: messages.length,
      hasMore: false,
      offset: 0,
      limit: null,
    };
  };
}

function idsOf(result: FetchHistoryResult): string[] {
  return result.messages.map((message) => message.id);
}

test('merges two legs chronologically with one boundary marker before the second leg', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude' });
  const legB = buildLeg({
    leg_id: 'b',
    seq: 1,
    provider: 'codex',
    profile_name_at_switch: 'Work Account',
    started_at: '2026-01-01T10:05:00.000Z',
  });

  const result = await fetchUnifiedHistory(
    SESSION,
    [legA, legB],
    { limit: null, offset: 0 },
    fetcherFor({
      a: [
        buildMessage('a1', '2026-01-01T10:00:00.000Z', 'claude'),
        buildMessage('a2', '2026-01-01T10:01:00.000Z', 'claude'),
      ],
      b: [buildMessage('b1', '2026-01-01T10:06:00.000Z', 'codex')],
    }),
  );

  assert.deepEqual(idsOf(result), ['a1', 'a2', 'leg-marker-b', 'b1']);
  assert.equal(result.total, 4);
  assert.equal(result.hasMore, false);

  const marker = result.messages[2];
  assert.equal(marker.kind, 'provider_switch');
  assert.equal(marker.switchProvider, 'codex');
  assert.equal(marker.switchProfileName, 'Work Account');
  assert.equal(marker.sessionId, SESSION.session_id);
});

test('leaves provider-native sessionId on real messages untouched', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude' });

  const result = await fetchUnifiedHistory(
    SESSION,
    [legA],
    { limit: null, offset: 0 },
    fetcherFor({ a: [buildMessage('a1', '2026-01-01T10:00:00.000Z', 'claude')] }),
  );

  assert.equal(result.messages[0].sessionId, 'provider-native-claude');
});

test('A -> B -> A interleaves by timestamp instead of concatenating legs in seq order', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude' });
  const legB = buildLeg({
    leg_id: 'b',
    seq: 1,
    provider: 'codex',
    started_at: '2026-01-01T10:10:00.000Z',
  });
  const legA2 = buildLeg({
    leg_id: 'a2',
    seq: 2,
    provider: 'claude',
    profile_name_at_switch: 'Personal',
    started_at: '2026-01-01T10:20:00.000Z',
  });

  const result = await fetchUnifiedHistory(
    SESSION,
    [legA, legB, legA2],
    { limit: null, offset: 0 },
    fetcherFor({
      a: [buildMessage('a1', '2026-01-01T10:00:00.000Z', 'claude')],
      b: [buildMessage('b1', '2026-01-01T10:11:00.000Z', 'codex')],
      a2: [buildMessage('a3', '2026-01-01T10:21:00.000Z', 'claude')],
    }),
  );

  assert.deepEqual(idsOf(result), [
    'a1',
    'leg-marker-b',
    'b1',
    'leg-marker-a2',
    'a3',
  ]);
});

test('a leg that resumed later keeps its newer messages after the following legs', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude' });
  const legB = buildLeg({
    leg_id: 'b',
    seq: 1,
    provider: 'codex',
    started_at: '2026-01-01T10:10:00.000Z',
  });

  const result = await fetchUnifiedHistory(
    SESSION,
    [legA, legB],
    { limit: null, offset: 0 },
    fetcherFor({
      a: [
        buildMessage('a1', '2026-01-01T10:00:00.000Z', 'claude'),
        buildMessage('a2-resumed', '2026-01-01T10:30:00.000Z', 'claude'),
      ],
      b: [buildMessage('b1', '2026-01-01T10:11:00.000Z', 'codex')],
    }),
  );

  assert.deepEqual(idsOf(result), ['a1', 'leg-marker-b', 'b1', 'a2-resumed']);
});

test('a leg without provider_session_id is skipped and produces no marker', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude' });
  const emptyLeg = buildLeg({
    leg_id: 'empty',
    seq: 1,
    provider: 'codex',
    provider_session_id: null,
    started_at: '2026-01-01T10:05:00.000Z',
  });
  const legC = buildLeg({
    leg_id: 'c',
    seq: 2,
    provider: 'cursor',
    started_at: '2026-01-01T10:06:00.000Z',
  });

  const fetchedLegIds: string[] = [];
  const fetcher: LegHistoryFetcher = async (session, leg) => {
    fetchedLegIds.push(leg.leg_id);
    return fetcherFor({
      a: [buildMessage('a1', '2026-01-01T10:00:00.000Z', 'claude')],
      c: [buildMessage('c1', '2026-01-01T10:07:00.000Z', 'cursor')],
    })(session, leg);
  };

  const result = await fetchUnifiedHistory(SESSION, [legA, emptyLeg, legC], { limit: null, offset: 0 }, fetcher);

  assert.deepEqual(fetchedLegIds, ['a', 'c']);
  assert.deepEqual(idsOf(result), ['a1', 'leg-marker-c', 'c1']);
  assert.equal(
    result.messages.some((message) => message.id === 'leg-marker-empty'),
    false,
  );
});

test('a failing leg becomes an error marker while the other legs still render', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude' });
  const legB = buildLeg({
    leg_id: 'b',
    seq: 1,
    provider: 'codex',
    started_at: '2026-01-01T10:05:00.000Z',
  });

  const result = await fetchUnifiedHistory(
    SESSION,
    [legA, legB],
    { limit: null, offset: 0 },
    fetcherFor(
      {
        a: [buildMessage('a1', '2026-01-01T10:00:00.000Z', 'claude')],
        b: [buildMessage('b1', '2026-01-01T10:06:00.000Z', 'codex')],
      },
      ['b'],
    ),
  );

  assert.deepEqual(idsOf(result), ['a1', 'leg-marker-b', 'leg-error-b']);

  const errorMarker = result.messages[2];
  assert.equal(errorMarker.kind, 'error');
  assert.equal(errorMarker.provider, 'codex');
  assert.equal(errorMarker.sessionId, SESSION.session_id);
  assert.match(String(errorMarker.content), /codex/);
  assert.doesNotMatch(String(errorMarker.content), /transcript unreadable/);
});

test('a failing first leg does not reject the whole merge', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude' });
  const legB = buildLeg({
    leg_id: 'b',
    seq: 1,
    provider: 'codex',
    started_at: '2026-01-01T10:05:00.000Z',
  });

  const result = await fetchUnifiedHistory(
    SESSION,
    [legA, legB],
    { limit: null, offset: 0 },
    fetcherFor({ b: [buildMessage('b1', '2026-01-01T10:06:00.000Z', 'codex')] }, ['a']),
  );

  assert.deepEqual(idsOf(result), ['leg-error-a', 'leg-marker-b', 'b1']);
});

test('offset/limit page the merged timeline using the shared tail contract', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude' });
  const legB = buildLeg({
    leg_id: 'b',
    seq: 1,
    provider: 'codex',
    started_at: '2026-01-01T10:05:00.000Z',
  });
  const fetcher = fetcherFor({
    a: [
      buildMessage('a1', '2026-01-01T10:00:00.000Z', 'claude'),
      buildMessage('a2', '2026-01-01T10:01:00.000Z', 'claude'),
    ],
    b: [
      buildMessage('b1', '2026-01-01T10:06:00.000Z', 'codex'),
      buildMessage('b2', '2026-01-01T10:07:00.000Z', 'codex'),
    ],
  });
  // Merged timeline: a1, a2, leg-marker-b, b1, b2 (5 entries).

  const newestPage = await fetchUnifiedHistory(SESSION, [legA, legB], { limit: 2, offset: 0 }, fetcher);
  assert.deepEqual(idsOf(newestPage), ['b1', 'b2']);
  assert.equal(newestPage.total, 5);
  assert.equal(newestPage.hasMore, true);
  assert.equal(newestPage.offset, 0);
  assert.equal(newestPage.limit, 2);

  const olderPage = await fetchUnifiedHistory(SESSION, [legA, legB], { limit: 2, offset: 2 }, fetcher);
  assert.deepEqual(idsOf(olderPage), ['a2', 'leg-marker-b']);
  assert.equal(olderPage.hasMore, true);

  const oldestPage = await fetchUnifiedHistory(SESSION, [legA, legB], { limit: 2, offset: 4 }, fetcher);
  assert.deepEqual(idsOf(oldestPage), ['a1']);
  assert.equal(oldestPage.hasMore, false);

  const everything = await fetchUnifiedHistory(SESSION, [legA, legB], { limit: null, offset: 0 }, fetcher);
  assert.deepEqual(idsOf(everything), ['a1', 'a2', 'leg-marker-b', 'b1', 'b2']);
  assert.equal(everything.hasMore, false);
});

test('a single-leg session returns the adapter messages with no synthetic markers', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude' });
  const messages = [
    buildMessage('a1', '2026-01-01T10:00:00.000Z', 'claude'),
    buildMessage('a2', '2026-01-01T10:01:00.000Z', 'claude'),
  ];

  const result = await fetchUnifiedHistory(
    SESSION,
    [legA],
    { limit: null, offset: 0 },
    fetcherFor({ a: messages }),
  );

  assert.deepEqual(result.messages, messages);
  assert.deepEqual(result, {
    messages,
    total: 2,
    hasMore: false,
    offset: 0,
    limit: null,
  });
});

test('legs with SQLite-style UTC timestamps place markers by real time, not local time', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude', started_at: '2026-01-01 10:00:00' });
  const legB = buildLeg({ leg_id: 'b', seq: 1, provider: 'codex', started_at: '2026-01-01 10:05:00' });

  const result = await fetchUnifiedHistory(
    SESSION,
    [legA, legB],
    { limit: null, offset: 0 },
    fetcherFor({
      a: [buildMessage('a1', '2026-01-01T10:01:00.000Z', 'claude')],
      b: [buildMessage('b1', '2026-01-01T10:06:00.000Z', 'codex')],
    }),
  );

  assert.deepEqual(idsOf(result), ['a1', 'leg-marker-b', 'b1']);
});

test('a message with a broken timestamp keeps its position instead of jumping to the top', async () => {
  const legA = buildLeg({ leg_id: 'a', seq: 0, provider: 'claude' });
  const legB = buildLeg({
    leg_id: 'b',
    seq: 1,
    provider: 'codex',
    started_at: '2026-01-01T10:05:00.000Z',
  });

  const result = await fetchUnifiedHistory(
    SESSION,
    [legA, legB],
    { limit: null, offset: 0 },
    fetcherFor({
      a: [buildMessage('a1', '2026-01-01T10:00:00.000Z', 'claude')],
      b: [
        buildMessage('b1', '2026-01-01T10:06:00.000Z', 'codex'),
        buildMessage('b2-broken', 'not-a-timestamp', 'codex'),
        buildMessage('b3', '2026-01-01T10:08:00.000Z', 'codex'),
      ],
    }),
  );

  assert.deepEqual(idsOf(result), ['a1', 'leg-marker-b', 'b1', 'b2-broken', 'b3']);
});
