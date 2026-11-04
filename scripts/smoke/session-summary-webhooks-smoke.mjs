#!/usr/bin/env node
/**
 * Smoke test for the agent-facing additions on a REAL server: `session_summary`,
 * `project_list { compact }`, session webhooks (upsert, masked secret, signed
 * delivery with retry, delivery log) and the `rfc` CLI driven as a subprocess.
 * No provider CLI is needed: the webhook is exercised through the test endpoint.
 * Not part of `npm test`:  node scripts/smoke/session-summary-webhooks-smoke.mjs
 */

import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootServer, createApiKey, createMcpClient, createScratchEnvironment, ledger, step } from './grokbot-mcp-smoke-helpers.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SECRET = 'smoke-secret-0123';
const env = createScratchEnvironment();
const server = await bootServer(REPO_ROOT, env);
const { baseUrl } = server;
const mcp = createMcpClient(baseUrl);
const { call } = mcp;

/** Local webhook receiver: fails the first request so the retry path is real. */
const received = [];
const receiver = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    received.push({ headers: req.headers, body });
    res.statusCode = received.length === 1 ? 500 : 200;
    res.end();
  });
});
await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;

/** Runs the CLI asynchronously: a blocking spawn would also freeze the receiver above. */
function rfc(apiKey, ...args) {
  return new Promise((resolve, reject) => {
    execFile('npx', ['tsx', '--tsconfig', 'server/tsconfig.json', 'server/rfc-cli/rfc-cli.ts', ...args], {
      cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, RFC_URL: baseUrl, RFC_API_KEY: apiKey },
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(`rfc ${args.join(' ')} failed: ${stderr || error.message}`));
      else resolve(stdout.trim());
    });
  });
}

let apiKey = '';
let projectId = '';
let sessionId = '';

try {
  await step('server boots', async () => { await server.waitForHealth(); return baseUrl; });
  await step('API key created', async () => { apiKey = await createApiKey(baseUrl, 'summary-smoke'); mcp.setApiKey(apiKey); });

  await step('project_create + session_create', async () => {
    const created = await call('project_create', { path: env.repo });
    projectId = created.project?.projectId ?? created.projectId ?? created.id;
    const session = await call('session_create', { provider: 'claude', projectPath: env.repo });
    sessionId = session.sessionId ?? session.id;
    if (!projectId || !sessionId) throw new Error(JSON.stringify({ created, session }));
    return `${projectId} / ${sessionId}`;
  });

  await step('session_summary on an idle session reads git', async () => {
    const summary = await call('session_summary', { sessionId });
    if (summary.status !== 'idle') throw new Error(`status ${summary.status}`);
    if (summary.git?.branch !== 'main' || !summary.git?.lastCommit?.hash) throw new Error(JSON.stringify(summary.git));
    if (summary.project?.path !== env.repo) throw new Error(JSON.stringify(summary.project));
    return `${JSON.stringify(summary).length} bytes`;
  });

  await step('project_list compact is small and names the project', async () => {
    const list = await call('project_list', { compact: true, skipSync: true });
    const item = list.find((entry) => entry.path === env.repo);
    if (!item || item.sessionsTotal !== 1 || item.activeSessions !== 0) throw new Error(JSON.stringify(list));
    return `${JSON.stringify(list).length} bytes for ${list.length} project(s)`;
  });

  await step('notification_endpoint_upsert registers a session_webhook and masks the secret', async () => {
    const result = await call('notification_endpoint_upsert', {
      channel: 'session_webhook', endpointId: 'smoke', url: receiverUrl, secret: SECRET, events: ['session.idle', 'session.error'],
    });
    const metadata = result.endpoint?.metadata ?? {};
    if (metadata.secret !== undefined || metadata.hasSecret !== true || metadata.url !== receiverUrl) throw new Error(JSON.stringify(result));
    const listed = await call('notification_endpoints', { channel: 'session_webhook' });
    if (JSON.stringify(listed).includes(SECRET)) throw new Error('secret leaked in listing');
  });

  await step('notification_endpoint_test delivers with retry and a valid HMAC', async () => {
    const result = await call('notification_endpoint_test', { endpointId: 'smoke' });
    if (!result.ok || received.length !== 2) throw new Error(JSON.stringify({ result, received: received.length }));
    const last = received[1];
    const expected = `sha256=${createHmac('sha256', SECRET).update(last.body).digest('hex')}`;
    if (last.headers['x-rfc-signature'] !== expected) throw new Error(`signature ${last.headers['x-rfc-signature']} != ${expected}`);
    const payload = JSON.parse(last.body);
    if (payload.event !== 'session.test' || last.headers['x-rfc-event'] !== 'session.test') throw new Error(last.body);
    return `attempts=${result.attempts} bytes=${last.body.length}`;
  });

  await step('notification_deliveries lists one row per attempt without the secret', async () => {
    const result = await call('notification_deliveries', { endpointId: 'smoke' });
    const rows = result.deliveries ?? result;
    if (!Array.isArray(rows) || rows.length !== 2) throw new Error(JSON.stringify(result));
    if (JSON.stringify(rows).includes(SECRET)) throw new Error('secret leaked in deliveries');
    return `${rows.map((row) => `#${row.attempt}:${row.httpStatus ?? row.http_status}`).join(' ')}`;
  });

  await step('second notification_endpoint_test succeeds first time', async () => {
    const result = await call('notification_endpoint_test', { endpointId: 'smoke' });
    if (!result.ok || result.attempts !== 1) throw new Error(JSON.stringify(result));
  });

  await step('rfc status / result / sessions / notify-test', async () => {
    const status = await rfc(apiKey, 'status', sessionId);
    if (!status.includes('idle') || status.split('\n').length > 10) throw new Error(status);
    const result = JSON.parse(await rfc(apiKey, 'result', sessionId, '--json'));
    if (result.git?.branch !== 'main') throw new Error(JSON.stringify(result));
    const sessions = await rfc(apiKey, 'sessions', '--project', 'smoke');
    if (!sessions.includes(sessionId)) throw new Error(sessions);
    const notify = await rfc(apiKey, 'notify-test', 'smoke');
    if (!notify.includes('ok=true')) throw new Error(notify);
    return `status ${status.split('\n').length} lines`;
  });
} finally {
  receiver.close();
  await server.stop();
  if (ledger.failures === 0) env.remove();
  else console.log(`scratch kept at ${env.root}`);
}

console.log(`\n${ledger.results.length - ledger.failures}/${ledger.results.length} passed`);
process.exit(ledger.failures === 0 ? 0 : 1);
