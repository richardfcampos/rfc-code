import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveQuickTitle, extractTicketReference } from '@/modules/providers/services/session-title-derive.js';
import {
  configureSessionTitleRuntime,
  ensureSessionTitle,
  type SessionTitleStore,
} from '@/modules/providers/services/session-title.service.js';

interface QueryCall {
  prompt: string;
  options: { cwd?: string; model?: string; profileId?: string };
}

/** Installs a fake runtime and records what it was asked. */
function installQuery(answer: string | (() => never)): QueryCall[] {
  const calls: QueryCall[] = [];
  configureSessionTitleRuntime(async (prompt, options) => {
    calls.push({ prompt, options });
    return typeof answer === 'function' ? answer() : answer;
  });
  return calls;
}

/** In-memory store that logs every write and notification in order. */
function fakeStore(initialTitle: string | null): SessionTitleStore & { titles: string[]; notified: number } {
  const state = { current: initialTitle, titles: [] as string[], notified: 0 };
  return {
    titles: state.titles,
    get notified() {
      return state.notified;
    },
    readTitle: () => state.current,
    writeTitle: (_sessionId, title) => {
      state.current = title;
      state.titles.push(title);
    },
    notify: () => {
      state.notified += 1;
    },
  };
}

test('a Linear issue URL names the session after its key', () => {
  const prompt = 'veja isso /map-league https://linear.app/oddsjam/issue/DOD-5702/fetcherunmapped-leagues-pinnacle';
  assert.equal(extractTicketReference(prompt), 'DOD-5702');
});

test('a Jira browse URL and a bare key both resolve, the URL first', () => {
  assert.equal(extractTicketReference('see https://acme.atlassian.net/browse/PAY-42 and DOD-1'), 'PAY-42');
  assert.equal(extractTicketReference('fix DOD-5702 please'), 'DOD-5702');
  assert.equal(extractTicketReference('handle utf-8 and sha-256 input'), null);
});

test('a GitHub pull request becomes repo#number', () => {
  const prompt = 'https://github.com/oddsjam/fetcher/pull/17028 tem conflito';
  assert.equal(extractTicketReference(prompt), 'fetcher#17028');
});

test('the quick title is the first non-empty line, clipped on a word', () => {
  assert.equal(deriveQuickTitle('\n\n  quero   um resumo\nsegunda linha'), 'quero um resumo');
  const long = 'palavra '.repeat(30).trim();
  const title = deriveQuickTitle(long);
  assert.ok(title.length <= 81, title);
  assert.ok(title.endsWith('…'));
  assert.ok(!title.includes('palavr…'));
});

// Must stay first among the runtime tests: no runtime has been wired yet.
test('with no runtime wired the quick title is written and that is all', async () => {
  const store = fakeStore(null);

  await ensureSessionTitle({ sessionId: 's1', prompt: 'quero um resumo da arquitetura' }, store);

  assert.deepEqual(store.titles, ['quero um resumo da arquitetura']);
  assert.equal(store.notified, 1);
});

test('a ticket reference is final: the model is never asked', async () => {
  const calls = installQuery('should not be used');
  const store = fakeStore(null);

  await ensureSessionTitle({ sessionId: 's1', prompt: 'work on DOD-5702 now' }, store);

  assert.deepEqual(store.titles, ['DOD-5702']);
  assert.equal(calls.length, 0);
});

test('without a ticket the model title replaces the quick one', async () => {
  const calls = installQuery('"Resumo da arquitetura."\n');
  const store = fakeStore(null);

  await ensureSessionTitle(
    { sessionId: 's1', prompt: 'quero um resumo da arquitetura', cwd: '/repo', profileId: 'p1' },
    store,
  );

  assert.deepEqual(store.titles, ['quero um resumo da arquitetura', 'Resumo da arquitetura']);
  assert.equal(store.notified, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { cwd: '/repo', profileId: 'p1', model: 'haiku' });
  assert.ok(calls[0].prompt.endsWith('quero um resumo da arquitetura'));
});

test('a rename that lands while the model thinks is kept', async () => {
  const store = fakeStore(null);
  configureSessionTitleRuntime(async () => {
    store.writeTitle('s1', 'renamed by the user');
    return 'model title';
  });

  await ensureSessionTitle({ sessionId: 's1', prompt: 'quero um resumo' }, store);

  assert.deepEqual(store.titles, ['quero um resumo', 'renamed by the user']);
});

test('a failing model run leaves the quick title in place', async () => {
  installQuery(() => {
    throw new Error('runtime down');
  });
  const store = fakeStore(null);

  await ensureSessionTitle({ sessionId: 's1', prompt: 'quero um resumo' }, store);

  assert.deepEqual(store.titles, ['quero um resumo']);
});

test('sessions that already have a real title are left alone', async () => {
  const calls = installQuery('model title');
  const titled = fakeStore('My session');
  const placeholder = fakeStore('Untitled Claude Session');

  await ensureSessionTitle({ sessionId: 's1', prompt: 'second turn DOD-1' }, titled);
  await ensureSessionTitle({ sessionId: 's2', prompt: 'first turn DOD-2' }, placeholder);

  assert.deepEqual(titled.titles, []);
  assert.deepEqual(placeholder.titles, ['DOD-2']);
  assert.equal(calls.length, 0);
});
