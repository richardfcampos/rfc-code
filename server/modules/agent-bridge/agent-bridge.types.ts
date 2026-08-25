/**
 * Contracts for the Agent Bridge module.
 *
 * The bridge owns no state of its own: it authenticates an agent process,
 * resolves the project that agent is scoped to, and forwards the call to the
 * Tasks and Orgs modules. Those collaborators are expressed as narrow ports so
 * the whole dispatch layer can be tested without a database, a WebSocket or a
 * live policy engine. The concrete adapters are bound in one place only —
 * `agent-bridge.module.ts`.
 */

import type { AgentMessageAnswer } from '@/modules/agent-messages/index.js';
import type { AgentMessageRow, TaskEvidenceRow, TaskRow } from '@/modules/database/index.js';
import type { ProfileRecommendation } from '@/modules/orgs/index.js';
import type { TaskUpdateAction } from '@/modules/tasks/index.js';
import type { LLMProvider } from '@/shared/types.js';

import type { AgentBridgeTokenPayload } from './agent-bridge-token.js';

/**
 * Everything a verified token is allowed to act on.
 *
 * `projectName` is the key the task board filters by, and `projectPath` is what
 * the org policy engine answers questions about — the bridge needs both, and
 * neither may ever come from the request body.
 */
export interface AgentBridgeSessionScope {
  sessionId: string;
  projectPath: string | null;
  projectName: string;
}

/** The slice of the Tasks service the bridge uses. */
export interface AgentBridgeTasksPort {
  createTask(body: Record<string, unknown>): Promise<TaskRow>;
  listTasks(project: unknown): TaskRow[];
  updateTask(id: unknown, body: Record<string, unknown>): Promise<TaskRow>;
  addEvidence(taskId: unknown, body: Record<string, unknown>): TaskEvidenceRow;
}

/** The slice of the org policy engine the bridge uses. */
export interface AgentBridgePolicyPort {
  assertProfileAllowed(projectPath: string | null, profileId: string): void;
}

/**
 * The slice of the handoff inbox the bridge uses.
 *
 * Every method takes the acting session id first, and the bridge always passes
 * the one from the verified token — the agent names a correspondent, never
 * itself. Field validation lives in the messages module, so the bridge forwards
 * the raw input instead of re-checking it here.
 */
export interface AgentBridgeMessagesPort {
  send(fromSessionId: string, body: Record<string, unknown>): AgentMessageRow;
  list(sessionId: string, filter: Record<string, unknown>): AgentMessageRow[];
  pullInbox(sessionId: string, filter: Record<string, unknown>): AgentMessageRow[];
  acknowledge(sessionId: string, messageId: unknown): AgentMessageRow;
  answer(sessionId: string, messageId: unknown, body: Record<string, unknown>): AgentMessageAnswer;
}

/** The slice of the quota-aware recommender the bridge uses. */
export interface AgentBridgeRecommendPort {
  recommend(projectPath: string | null, provider?: LLMProvider): Promise<ProfileRecommendation>;
}

/**
 * Live fan-out for board clients.
 *
 * A task created by an agent has to reach open boards exactly like one created
 * from the UI, so every bridge mutation goes through the same broadcast the
 * REST router uses.
 */
export type AgentBridgeBroadcast = (task: TaskRow, action: TaskUpdateAction) => void;

export interface AgentBridgeToolDeps {
  tasks: AgentBridgeTasksPort;
  messages: AgentBridgeMessagesPort;
  policy: AgentBridgePolicyPort;
  recommend: AgentBridgeRecommendPort;
  broadcast: AgentBridgeBroadcast;
}

/**
 * Session liveness lookup.
 *
 * Returns null once the session is gone, which is what stops a leaked token
 * from outliving the run it was minted for.
 */
export type ResolveAgentBridgeSessionScope = (sessionId: string) => AgentBridgeSessionScope | null;

export interface AgentBridgeRouterDeps extends AgentBridgeToolDeps {
  verifyToken(token: string): AgentBridgeTokenPayload | null;
  resolveSessionScope: ResolveAgentBridgeSessionScope;
}

/** Ready-to-paste stdio MCP registration for one session. */
export interface AgentBridgeMcpRegistration {
  name: string;
  transport: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface AgentBridgeSessionTokenDeps {
  resolveSessionScope: ResolveAgentBridgeSessionScope;
  mintToken(scope: AgentBridgeSessionScope): string;
  describeRegistration(scope: AgentBridgeSessionScope, token: string): AgentBridgeMcpRegistration;
}
