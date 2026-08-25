/**
 * Composition root of the Agent Bridge module.
 *
 * The only file that binds the bridge to real storage, the real task service,
 * the real policy engine and the real broadcast; every layer below stays a
 * function of injected ports so the whole surface is testable without a
 * database or a socket.
 */

import path from 'node:path';
import fs from 'node:fs';

import { agentMessagesService } from '@/modules/agent-messages/index.js';
import { appConfigDb, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { orgPolicyService, orgRecommendService } from '@/modules/orgs/index.js';
import { broadcastTaskUpdate, taskDecompositionService, tasksService } from '@/modules/tasks/index.js';
import { getModuleDir } from '@/utils/runtime-paths.js';

import {
  deriveAgentBridgeSecret,
  signAgentBridgeToken,
  verifyAgentBridgeToken,
} from './agent-bridge-token.js';
import {
  createAgentBridgeRouter,
  createAgentBridgeSessionTokenRouter,
} from './agent-bridge.routes.js';
import type {
  AgentBridgeMcpRegistration,
  AgentBridgeSessionScope,
} from './agent-bridge.types.js';

const __dirname = getModuleDir(import.meta.url);

const MCP_SERVER_NAME = 'cloudcli-agent-bridge';
const TOKEN_ENV_VAR = 'CLOUDCLI_AGENT_BRIDGE_TOKEN';
const API_URL_ENV_VAR = 'CLOUDCLI_AGENT_BRIDGE_API_URL';

/**
 * Signing key, derived once from the installation secret.
 *
 * Resolved lazily: the secret lives in the database, and the module graph is
 * imported before the first request but not necessarily before the connection
 * is open.
 */
let cachedSecret: Buffer | null = null;

function getSecret(): Buffer {
  if (!cachedSecret) {
    cachedSecret = deriveAgentBridgeSecret(process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret());
  }
  return cachedSecret;
}

/**
 * Resolves what a session is allowed to touch.
 *
 * The board is filtered by the project registry id, so that is the key tasks
 * are stored under; a path that was never registered as a project falls back to
 * its directory name, which keeps the bridge usable instead of failing the call.
 */
function resolveSessionScope(sessionId: string): AgentBridgeSessionScope | null {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    return null;
  }

  const projectPath = session.project_path ?? null;
  const registered = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  if (projectPath && !registered) {
    console.warn('[agent-bridge] session project path is not a registered project', {
      sessionId,
      projectPath,
    });
  }

  const projectName = registered?.project_id ?? (projectPath ? path.basename(projectPath) : '');
  if (!projectName) {
    console.warn('[agent-bridge] session has no resolvable project scope', { sessionId });
    return null;
  }

  return { sessionId: session.session_id, projectPath, projectName };
}

/** Mints the bearer credential an agent process presents to the tools router. */
export function mintAgentBridgeToken(scope: AgentBridgeSessionScope): string {
  return signAgentBridgeToken(
    {
      sessionId: scope.sessionId,
      projectPath: scope.projectPath,
      projectName: scope.projectName,
    },
    getSecret(),
  );
}

function getMcpCommand(): { command: string; args: string[] } {
  const serverDir = path.resolve(__dirname, '..', '..');
  const mcpScriptPath = path.join(serverDir, 'agent-bridge-mcp.js');
  if (fs.existsSync(mcpScriptPath)) {
    return { command: process.execPath, args: [mcpScriptPath] };
  }

  return { command: 'cloudcli', args: ['agent-bridge-mcp'] };
}

function getMcpApiUrl(): string {
  const port = process.env.SERVER_PORT || process.env.PORT || '3001';
  return `http://127.0.0.1:${port}/api/agent-bridge`;
}

/**
 * Describes the stdio MCP server registration for one session.
 *
 * The token is per session, so this cannot be registered once for the whole
 * installation the way a static-token MCP server can: each session gets its own
 * env block, which the UI (or a human, see README) writes into the provider's
 * MCP config.
 */
function describeRegistration(
  _scope: AgentBridgeSessionScope,
  token: string,
): AgentBridgeMcpRegistration {
  const { command, args } = getMcpCommand();
  return {
    name: MCP_SERVER_NAME,
    transport: 'stdio',
    command,
    args,
    env: {
      [TOKEN_ENV_VAR]: token,
      [API_URL_ENV_VAR]: getMcpApiUrl(),
    },
  };
}

/** Agent-facing tools router, mounted by the entrypoint at `/api/agent-bridge`. */
export const agentBridgeRoutes = createAgentBridgeRouter({
  tasks: tasksService,
  decomposition: taskDecompositionService,
  // The handoff inbox broadcasts its own state changes, so unlike the task
  // tools these do not go through the `broadcast` port below.
  messages: agentMessagesService,
  policy: orgPolicyService,
  recommend: orgRecommendService,
  broadcast: broadcastTaskUpdate,
  verifyToken: (token) => verifyAgentBridgeToken(token, getSecret()),
  resolveSessionScope,
});

/**
 * UI-facing token minting, mounted by the entrypoint behind `authenticateToken`
 * at `/api/agent-bridge/session-token`.
 */
export const agentBridgeSessionTokenRoutes = createAgentBridgeSessionTokenRouter({
  resolveSessionScope,
  mintToken: mintAgentBridgeToken,
  describeRegistration,
});
