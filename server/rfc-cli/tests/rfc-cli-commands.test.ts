import assert from 'node:assert/strict';
import test from 'node:test';

import { runNotifyTest, runResult, runSend, runSessions, runStatus, type CallTool } from '../rfc-cli-commands.js';

import { compactProjects, errorSummary, idleSummary, notifyTestResult, projectSessionsPages, runningSessions, waitingSummary } from './support/fixtures.js';

type Call = { name: string; args: Record<string, unknown> | undefined };

function scriptedClient(responses: Record<string, unknown | ((args: Record<string, unknown> | undefined) => unknown)>): { callTool: CallTool; calls: Call[] } {
  const calls: Call[] = [];
  const callTool: CallTool = async (name, args) => {
    calls.push({ name, args });
    if (!(name in responses)) throw new Error(`unexpected tool ${name}`);
    const response = responses[name];
    return typeof response === 'function' ? (response as (a: Record<string, unknown> | undefined) => unknown)(args) : response;
  };
  return { callTool, calls };
}

test('send: session_send without wait, then session_status for the seq', async () => {
  const client = scriptedClient({
    session_send: { sessionId: 'sess-abc', provider: 'claude', started: true },
    session_status: { sessionId: 'sess-abc', isProcessing: true, lastSeq: 3, provider: 'claude' },
  });
  const output = await runSend(client.callTool, 'sess-abc', 'fix it');
  assert.deepEqual(client.calls, [
    { name: 'session_send', args: { sessionId: 'sess-abc', content: 'fix it' } },
    { name: 'session_status', args: { sessionId: 'sess-abc' } },
  ]);
  assert.equal(output.text, 'sent sess-abc seq=3');
  assert.deepEqual(output.json, { sessionId: 'sess-abc', provider: 'claude', started: true, lastSeq: 3 });
});

test('status: at most 10 lines and a json view without the response, tests and file list', async () => {
  const client = scriptedClient({ session_summary: idleSummary });
  const output = await runStatus(client.callTool, 'sess-abc');
  assert.deepEqual(client.calls, [{ name: 'session_summary', args: { sessionId: 'sess-abc' } }]);
  const lines = output.text.split('\n');
  assert.ok(lines.length <= 10, `got ${lines.length} lines`);
  assert.match(output.text, /^status\s+idle$/m);
  assert.match(output.text, /^project\s+rfc-code$/m);
  assert.match(output.text, /^branch\s+feat\/x$/m);
  assert.match(output.text, /^duration\s+3m 04s$/m);
  assert.match(output.text, /^lastSeq\s+412$/m);
  assert.match(output.text, /^approval\s+none$/m);
  assert.doesNotMatch(output.text, /^error/m);
  const json = output.json as Record<string, unknown>;
  assert.equal('response' in json, false);
  assert.equal('tests' in json, false);
  assert.deepEqual(json.git, { branch: 'feat/x', diffStat: idleSummary.git!.diffStat, untracked: 1, lastCommit: idleSummary.git!.lastCommit });
  assert.equal(json.status, 'idle');
});

test('status: pending approval and error lines when present', async () => {
  const waiting = await runStatus(scriptedClient({ session_summary: waitingSummary }).callTool, 'sess-wait');
  assert.match(waiting.text, /^approval\s+Bash: rm -rf dist$/m);
  assert.match(waiting.text, /^branch\s+-$/m);
  const failed = await runStatus(scriptedClient({ session_summary: errorSummary }).callTool, 'sess-err');
  assert.match(failed.text, /^error\s+The run stopped without reporting a reason\.$/m);
  assert.ok(failed.text.split('\n').length <= 10);
});

test('result: passes sinceSeq through and renders every section', async () => {
  const client = scriptedClient({ session_summary: idleSummary });
  const output = await runResult(client.callTool, 'sess-abc', 400);
  assert.deepEqual(client.calls, [{ name: 'session_summary', args: { sessionId: 'sess-abc', sinceSeq: 400 } }]);
  assert.deepEqual(output.json, idleSummary);
  const text = output.text;
  assert.match(text, /^idle {2}rfc-code {2}duration=3m 04s {2}lastSeq=412$/m);
  assert.match(text, /--- response\nDone\. I fixed the parser/);
  assert.match(text, /--- changes\n3 files changed, 41 insertions\(\+\), 2 deletions\(-\)\n {2}server\/a\.ts\n {2}server\/b\.ts\n {2}README\.md\nuntracked: 1/);
  assert.match(text, /--- tests\nnode:test passed=42 failed=0 total=42/);
  assert.match(text, /--- commit\n8f862e0 fix\(taskmaster\): seed tasks\.json\nbranch: feat\/x/);
});

test('result: omits sinceSeq when not given; truncated response, no git, no tests', async () => {
  const client = scriptedClient({ session_summary: errorSummary });
  const output = await runResult(client.callTool, 'sess-err');
  assert.deepEqual(client.calls[0].args, { sessionId: 'sess-err' });
  assert.match(output.text, /^error {2}rfc-code/m);
  assert.match(output.text, /error: The run stopped/);
  assert.match(output.text, /x{1500}\n…\(truncated\)/);
  assert.match(output.text, /vitest passed=10 failed=2 total=12/);

  const waiting = await runResult(scriptedClient({ session_summary: waitingSummary }).callTool, 'sess-wait');
  assert.match(waiting.text, /approval: Bash: rm -rf dist/);
  assert.match(waiting.text, /--- response\n\(none\)/);
  assert.match(waiting.text, /--- changes\n\(not a git repository\)/);
  assert.match(waiting.text, /--- tests\nnot detected/);
  assert.match(waiting.text, /--- commit\n\(none\)\nbranch: -/);
});

test('sessions: compact project list + per-project pages + running states, newest first', async () => {
  const client = scriptedClient({
    project_list: compactProjects,
    session_list_running: runningSessions,
    project_sessions: (args: Record<string, unknown> | undefined) => projectSessionsPages[String(args?.projectId)],
  });
  const output = await runSessions(client.callTool);
  assert.deepEqual(client.calls[0], { name: 'project_list', args: { compact: true, skipSync: true } });
  assert.deepEqual(client.calls[1], { name: 'session_list_running', args: {} });
  assert.deepEqual(client.calls.slice(2).map((call) => call.args), [{ projectId: 'proj-1', limit: 20 }, { projectId: 'proj-2', limit: 20 }]);
  const json = output.json as Array<Record<string, unknown>>;
  assert.deepEqual(json.map((line) => [line.sessionId, line.project, line.state]), [
    ['sess-abc', 'rfc-code', 'running'],
    ['sess-wait', 'rfc-code', 'waiting_approval'],
    ['sess-old', 'comanda', 'idle'],
  ]);
  const lines = output.text.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^sess-abc {2,}rfc-code {2,}running {2,}2026-11-04T01:13:07\.000Z {2}Fix the parser and add tests for the ed…$/);
  assert.match(lines[2], /^sess-old {2,}comanda {2,}idle {2,}2026-11-03T20:00:00\.000Z$/);
});

test('sessions: --project filters by name or path, case-insensitively', async () => {
  const client = scriptedClient({
    project_list: compactProjects,
    session_list_running: { sessions: [] },
    project_sessions: (args: Record<string, unknown> | undefined) => projectSessionsPages[String(args?.projectId)],
  });
  const output = await runSessions(client.callTool, 'COMANDA');
  assert.deepEqual(client.calls.filter((call) => call.name === 'project_sessions').map((call) => call.args?.projectId), ['proj-2']);
  assert.equal(output.text, 'sess-old  comanda  idle  2026-11-03T20:00:00.000Z');
  const none = await runSessions(scriptedClient({ project_list: [], session_list_running: { sessions: [] } }).callTool, 'zzz');
  assert.equal(none.text, '(no sessions)');
  assert.deepEqual(none.json, []);
});

test('notify-test: one line with ok, delivery id, attempts and http status', async () => {
  const client = scriptedClient({ notification_endpoint_test: notifyTestResult });
  const output = await runNotifyTest(client.callTool, 'james');
  assert.deepEqual(client.calls, [{ name: 'notification_endpoint_test', args: { endpointId: 'james' } }]);
  assert.equal(output.text, 'ok=true deliveryId=dlv_01 attempts=1 status=200');
  assert.deepEqual(output.json, notifyTestResult);
  const failed = await runNotifyTest(scriptedClient({ notification_endpoint_test: { ok: false, deliveryId: 'dlv_02', attempts: 3, lastStatus: null, error: 'connect ECONNREFUSED' } }).callTool, 'james');
  assert.equal(failed.text, 'ok=false deliveryId=dlv_02 attempts=3 status=- error=connect ECONNREFUSED');
});

test('an unexpected response shape is an error, not a crash', async () => {
  await assert.rejects(runStatus(scriptedClient({ session_summary: 'oops' }).callTool, 's'), /session_summary returned an unexpected response/);
});
