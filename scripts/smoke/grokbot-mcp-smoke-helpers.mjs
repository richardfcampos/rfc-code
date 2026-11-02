/**
 * Helpers for the Grokbot MCP smoke test: isolated environment, real server
 * process, JSON-RPC client and PASS/FAIL ledger. Steps: grokbot-mcp-smoke.mjs.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, openSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const ledger = { results: [], failures: 0 };

/** One tool per section; the listing must contain all of them. */
export const EXPECTED_TOOL_NAMES = [
  'project_list', 'file_read', 'session_create', 'session_send', 'worktree_list', 'git_status', 'task_create',
  'review_list', 'automation_list', 'org_list', 'profile_list', 'provider_models', 'mcp_server_list', 'plugin_list',
  'api_key_list', 'notify_hub_get', 'collab_list', 'team_view', 'taskmaster_tasks', 'preview_status', 'command_list',
  'shell_exec', 'asset_upload_file', 'rfc_api_call',
];

/** Trusted mode needs no JWT, so a plain POST mints the bot's key. */
export async function createApiKey(baseUrl, keyName) {
  const response = await fetch(`${baseUrl}/api/settings/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyName }),
  });
  const body = await response.json();
  const apiKey = body?.apiKey?.apiKey ?? '';
  if (!apiKey) throw new Error(`unexpected body: ${JSON.stringify(body)}`);
  return apiKey;
}

function record(name, ok, detail = '') {
  ledger.results.push({ name, ok, detail });
  if (!ok) ledger.failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

export async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === 'string' ? detail : '');
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
  return run.stdout.trim();
}

/**
 * A scratch home, database, profiles root and workspace with one committed
 * git repo. Not under os.tmpdir(): `/tmp` is on the server's forbidden
 * workspace list, so a project created there would be refused.
 */
export function createScratchEnvironment() {
  const scratchParent = path.join(os.homedir(), '.cache', 'grokbot-smoke');
  mkdirSync(scratchParent, { recursive: true });
  const root = mkdtempSync(path.join(scratchParent, 'run-'));
  const home = path.join(root, 'home');
  const workspaces = path.join(root, 'workspaces');
  const repo = path.join(workspaces, 'smoke-repo');
  for (const dir of [home, workspaces, repo, path.join(root, 'profiles')]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(repo, 'README.md'), '# smoke\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'smoke@example.com');
  git(repo, 'config', 'user.name', 'Smoke');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'initial');
  return {
    root,
    home,
    workspaces,
    repo,
    logPath: path.join(root, 'server.log'),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Boots server/index.js on a free port with every data location inside `env`. */
export async function bootServer(repoRoot, env) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logFd = openSync(env.logPath, 'a');
  const child = spawn('npx', ['tsx', '--tsconfig', 'server/tsconfig.json', 'server/index.js'], {
    cwd: repoRoot,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      HOME: env.home,
      CLAUDE_CONFIG_DIR: path.join(env.home, '.claude'),
      PROFILES_ROOT: path.join(env.root, 'profiles'),
      DATABASE_PATH: path.join(env.root, 'auth.db'),
      WORKSPACES_ROOT: env.workspaces,
      AUTH_MODE: 'trusted',
      HOST: '127.0.0.1',
      SERVER_PORT: String(port),
      NODE_ENV: 'development',
      API_KEY: '',
    },
  });

  async function waitForHealth(timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode}); see ${env.logPath}`);
      try {
        const response = await fetch(`${baseUrl}/health`);
        if (response.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`server did not answer /health within ${timeoutMs}ms; see ${env.logPath}`);
  }

  async function stop() {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 8000);
      child.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  return { baseUrl, waitForHealth, stop };
}

/** JSON-RPC client over the MCP endpoint; `setApiKey` once a key exists. */
export function createMcpClient(baseUrl) {
  let apiKey = '';
  let rpcId = 0;

  async function rpcRaw(body, headers = {}) {
    const response = await fetch(`${baseUrl}/api/grokbot-mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  }

  async function rpc(method, params = {}) {
    const { status, json } = await rpcRaw({ jsonrpc: '2.0', id: ++rpcId, method, params }, { Authorization: `Bearer ${apiKey}` });
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(json)}`);
    if (json.error) throw new Error(`JSON-RPC ${json.error.code}: ${json.error.message}`);
    return json.result;
  }

  async function call(name, args = {}) {
    const result = await rpc('tools/call', { name, arguments: args });
    const text = result.content?.[0]?.text ?? '';
    if (result.isError) throw new Error(`tool ${name} failed: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async function callExpectingError(name, args, needle) {
    const result = await rpc('tools/call', { name, arguments: args });
    const text = result.content?.[0]?.text ?? '';
    if (!result.isError) throw new Error(`expected isError for ${name}, got: ${text}`);
    if (needle && !text.includes(needle)) throw new Error(`expected "${needle}" in: ${text}`);
    return text;
  }

  return {
    rpcRaw,
    rpc,
    call,
    callExpectingError,
    setApiKey: (key) => { apiKey = key; },
    authHeaders: () => ({ Authorization: `Bearer ${apiKey}` }),
  };
}
