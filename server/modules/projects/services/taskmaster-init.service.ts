import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution — required
// because `task-master` is an npm-installed shim on Windows.
import spawn from 'cross-spawn';

type SpawnLike = typeof spawn;

type ModelRole = 'main' | 'research' | 'fallback';

type TaskMasterModelConfig = {
  provider?: string;
  modelId?: string;
  maxTokens?: number;
  temperature?: number;
};

type TaskMasterConfig = {
  models?: Partial<Record<ModelRole, TaskMasterModelConfig>>;
  [key: string]: unknown;
};

export type TaskMasterInitResult = {
  initialized: boolean;
  tasksFileCreated: boolean;
  providersUpdated: boolean;
  output: string;
};

export type TaskMasterInitDependencies = {
  spawnFn?: SpawnLike;
  env?: NodeJS.ProcessEnv;
};

// The CLI binary shipped by the `task-master-ai` package. Never spawn
// `npx task-master-ai`: that bin is the MCP server, which ignores CLI args.
export const TASK_MASTER_BIN = 'task-master';

// Non-interactive init: the default `task-master init` opens a Solo/Hamster
// picker and git prompts on stdin, which hang when driven by the server.
// No `--rules`: that mode rewrites the project's .mcp.json and stamps
// `type: stdio` on HTTP servers, breaking them. `--git-tasks` keeps
// .taskmaster/tasks out of .gitignore so tasks travel with the repo.
const INIT_ARGS = ['init', '-y', '--no-aliases', '--skip-install', '--git-tasks'];

// Files the CLI appends to or creates even without `--rules`; restored after
// init so a project only gains .taskmaster/ from the app.
const PRESERVED_FILES = ['.gitignore', '.env.example', 'CLAUDE.md'];

// `task-master init` creates `.taskmaster/tasks/` but not the `tasks.json`
// inside it (verified with 0.43.1), and the app treats a folder without that
// file as unconfigured. Seeded in the tagged format the CLI writes itself.
const TASKS_FILE = path.join('.taskmaster', 'tasks', 'tasks.json');

// Providers that shell out to a locally installed agent CLI and need no API key.
const CLI_PROVIDERS = new Set(['claude-code', 'codex-cli', 'gemini-cli', 'grok-cli']);

// Env var each hosted provider reads its key from (task-master naming).
const PROVIDER_API_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  xai: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  azure: 'AZURE_OPENAI_API_KEY',
};

// Roles that lose their hosted provider fall back to the Claude Code CLI, the
// one agent this app always has installed. Model ids follow `task-master
// models --claude-code` naming.
const CLI_FALLBACK_MODELS: Record<ModelRole, TaskMasterModelConfig> = {
  main: { provider: 'claude-code', modelId: 'opus', maxTokens: 32000, temperature: 0.2 },
  research: { provider: 'claude-code', modelId: 'opus', maxTokens: 32000, temperature: 0.1 },
  fallback: { provider: 'claude-code', modelId: 'sonnet', maxTokens: 32000, temperature: 0.2 },
};

const PLACEHOLDER_KEY_PATTERN = /KEY_HERE|^YOUR_/i;

function isUsableApiKey(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 && !PLACEHOLDER_KEY_PATTERN.test(trimmed);
}

async function readProjectDotEnv(projectPath: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(path.join(projectPath, '.env'), 'utf8');
    const entries: Record<string, string> = {};
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2');
      entries[key] = value;
    }
    return entries;
  } catch {
    return {};
  }
}

function providerHasCredentials(provider: string, env: Record<string, string | undefined>): boolean {
  if (CLI_PROVIDERS.has(provider)) {
    return true;
  }
  const envName = PROVIDER_API_KEY_ENV[provider];
  // Unknown providers (ollama, lmstudio, bedrock, ...) are left untouched.
  if (!envName) {
    return true;
  }
  return isUsableApiKey(env[envName]);
}

/**
 * Rewrites `.taskmaster/config.json` model roles whose hosted provider has no
 * usable API key (process env or project `.env`) to the Claude Code CLI.
 * A fresh `task-master init` defaults to anthropic + perplexity, so without
 * this every AI command in a new project fails on missing keys.
 * Returns true when the config was changed.
 */
export async function ensureTaskMasterCliProviders(
  projectPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const configPath = path.join(projectPath, '.taskmaster', 'config.json');

  let config: TaskMasterConfig;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8')) as TaskMasterConfig;
  } catch {
    return false;
  }

  const models = config.models ?? {};
  const mergedEnv = { ...(await readProjectDotEnv(projectPath)), ...env };
  let changed = false;

  for (const role of Object.keys(CLI_FALLBACK_MODELS) as ModelRole[]) {
    const provider = models[role]?.provider;
    if (!provider || providerHasCredentials(provider, mergedEnv)) {
      continue;
    }
    models[role] = { ...CLI_FALLBACK_MODELS[role] };
    changed = true;
  }

  if (!changed) {
    return false;
  }

  config.models = models;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * Creates an empty `.taskmaster/tasks/tasks.json` when the project has none,
 * so detection reports the project as configured and the CLI has a file to
 * append to. Returns true when the file was created.
 */
async function ensureTasksFile(projectPath: string): Promise<boolean> {
  const tasksPath = path.join(projectPath, TASKS_FILE);
  try {
    await access(tasksPath);
    return false;
  } catch {
    // Missing: seed it below.
  }

  const now = new Date().toISOString();
  const emptyTasks = {
    master: {
      tasks: [],
      metadata: { created: now, updated: now, description: 'Tasks for master context' },
    },
  };
  await mkdir(path.dirname(tasksPath), { recursive: true });
  await writeFile(tasksPath, `${JSON.stringify(emptyTasks, null, 2)}\n`, 'utf8');
  return true;
}

async function hasTaskMasterDirectory(projectPath: string): Promise<boolean> {
  try {
    await access(path.join(projectPath, '.taskmaster'));
    return true;
  } catch {
    return false;
  }
}

async function snapshotFiles(projectPath: string): Promise<Map<string, string | null>> {
  const snapshot = new Map<string, string | null>();
  for (const name of PRESERVED_FILES) {
    try {
      snapshot.set(name, await readFile(path.join(projectPath, name), 'utf8'));
    } catch {
      snapshot.set(name, null);
    }
  }
  return snapshot;
}

async function restoreFiles(projectPath: string, snapshot: Map<string, string | null>): Promise<void> {
  for (const [name, content] of snapshot) {
    const filePath = path.join(projectPath, name);
    if (content === null) {
      await rm(filePath, { force: true });
    } else {
      await writeFile(filePath, content, 'utf8');
    }
  }
}

function runInit(projectPath: string, spawnFn: SpawnLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(TASK_MASTER_BIN, INIT_ARGS, {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `task-master init exited with code ${code}`));
    });
  });
}

/**
 * Idempotent TaskMaster bootstrap for a project directory: runs the
 * non-interactive init when `.taskmaster` is missing, seeds the tasks file
 * the CLI leaves out, then makes sure the model config only references
 * providers the machine can actually use. Safe to call on an already
 * initialized project — it only fills in what is missing.
 */
export async function initializeTaskMaster(
  projectPath: string,
  dependencies: TaskMasterInitDependencies = {},
): Promise<TaskMasterInitResult> {
  const spawnFn = dependencies.spawnFn ?? spawn;
  const env = dependencies.env ?? process.env;

  let initialized = false;
  let output = '';
  if (!(await hasTaskMasterDirectory(projectPath))) {
    const snapshot = await snapshotFiles(projectPath);
    try {
      output = await runInit(projectPath, spawnFn);
    } finally {
      await restoreFiles(projectPath, snapshot);
    }
    initialized = true;
  }

  const tasksFileCreated = await ensureTasksFile(projectPath);
  const providersUpdated = await ensureTaskMasterCliProviders(projectPath, env);
  return { initialized, tasksFileCreated, providersUpdated, output };
}
