/**
 * Tool dispatch for the Agent Bridge.
 *
 * One function per MCP tool, all of them scoped by the session's token: the
 * agent names a task, a profile or a correspondent — never a project, and never
 * itself. Input arrives straight off the wire, so every field is validated
 * before it reaches the Tasks or Orgs modules — manual checks in the same style
 * as the other MCP surface.
 *
 * The `message_*` tools are the exception to validating here: the Agent
 * Messages module validates every field of a handoff and throws the same kind
 * of named `AppError`, so those tools forward the raw input rather than
 * checking the same lengths twice in two places that could drift apart.
 */

import type { AgentMessageAnswer } from '@/modules/agent-messages/index.js';
import type { AgentMessageRow, TaskEvidenceRow, TaskRow, TaskStage } from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';

import {
  AgentBridgeTaskNotFoundError,
  AgentBridgeUnknownToolError,
  AgentBridgeValidationError,
} from './agent-bridge.errors.js';
import type { AgentBridgeSessionScope, AgentBridgeToolDeps } from './agent-bridge.types.js';

const TASK_STAGES: readonly TaskStage[] = ['backlog', 'in_progress', 'review', 'done'];
const PROVIDERS: readonly LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];
/** Attachment upload is out of scope for the bridge; agents log a file path as a link instead. */
const AGENT_EVIDENCE_KINDS = ['note', 'link'] as const;
type AgentEvidenceKind = (typeof AGENT_EVIDENCE_KINDS)[number];

/** Which side of its mailbox a session is asking for. */
const MESSAGE_BOXES = ['inbox', 'outbox'] as const;
type MessageBox = (typeof MESSAGE_BOXES)[number];

export const AGENT_BRIDGE_TOOL_NAMES = [
  'task_create',
  'task_list',
  'task_update_stage',
  'task_update_description',
  'task_assign',
  'task_evidence_add',
  'message_send',
  'message_list',
  'message_ack',
  'message_answer',
  'profile_recommend',
] as const;

function readRequiredString(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new AgentBridgeValidationError(`${field} is required.`);
  }
  return text;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new AgentBridgeValidationError(`${field} must be a string.`);
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function readStage(value: unknown, field: string): TaskStage {
  const stage = readRequiredString(value, field);
  if (!TASK_STAGES.includes(stage as TaskStage)) {
    throw new AgentBridgeValidationError(`${field} must be one of: ${TASK_STAGES.join(', ')}`);
  }
  return stage as TaskStage;
}

function readEvidenceKind(value: unknown, field: string): AgentEvidenceKind {
  const kind = readRequiredString(value, field);
  if (!AGENT_EVIDENCE_KINDS.includes(kind as AgentEvidenceKind)) {
    throw new AgentBridgeValidationError(`${field} must be one of: ${AGENT_EVIDENCE_KINDS.join(', ')}`);
  }
  return kind as AgentEvidenceKind;
}

function readOptionalProvider(value: unknown): LLMProvider | undefined {
  const provider = readOptionalString(value, 'provider');
  if (provider === undefined) {
    return undefined;
  }
  if (!PROVIDERS.includes(provider as LLMProvider)) {
    throw new AgentBridgeValidationError(`provider must be one of: ${PROVIDERS.join(', ')}`);
  }
  return provider as LLMProvider;
}

/**
 * Resolves a task id inside the caller's project.
 *
 * The board is listed per project, so this doubles as the authorization check
 * that keeps one session's token from moving or assigning another project's
 * tasks: an id outside the scope is reported as "not found".
 */
function requireTaskInScope(
  deps: AgentBridgeToolDeps,
  scope: AgentBridgeSessionScope,
  taskId: string,
): TaskRow {
  const task = deps.tasks.listTasks(scope.projectName).find((row) => row.id === taskId);
  if (!task) {
    throw new AgentBridgeTaskNotFoundError(taskId);
  }
  return task;
}

async function taskCreate(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): Promise<{ task: TaskRow }> {
  const task = await deps.tasks.createTask({
    title: readRequiredString(input.title, 'title'),
    project: scope.projectName,
    description: readOptionalString(input.description, 'description') ?? null,
    suggested_skill: readOptionalString(input.suggested_skill, 'suggested_skill') ?? null,
    // Board cards show where a task came from; the session id is what makes an
    // agent-created task traceable back to the run that asked for it.
    origin: 'agent',
    origin_detail: scope.sessionId,
  });

  deps.broadcast(task, 'created');
  return { task };
}

function taskList(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): { tasks: TaskRow[] } {
  const tasks = deps.tasks.listTasks(scope.projectName);
  if (input.stage === undefined || input.stage === null) {
    return { tasks };
  }

  const stage = readStage(input.stage, 'stage');
  return { tasks: tasks.filter((task) => task.stage === stage) };
}

async function taskUpdateStage(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): Promise<{ task: TaskRow }> {
  const taskId = readRequiredString(input.taskId, 'taskId');
  const stage = readStage(input.stage, 'stage');
  requireTaskInScope(deps, scope, taskId);

  const task = await deps.tasks.updateTask(taskId, { stage });
  deps.broadcast(task, 'updated');
  return { task };
}

async function taskUpdateDescription(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): Promise<{ task: TaskRow }> {
  const taskId = readRequiredString(input.taskId, 'taskId');
  const description = readRequiredString(input.description, 'description');
  requireTaskInScope(deps, scope, taskId);

  const task = await deps.tasks.updateTask(taskId, { description });
  deps.broadcast(task, 'updated');
  return { task };
}

async function taskAssign(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): Promise<{ task: TaskRow }> {
  const taskId = readRequiredString(input.taskId, 'taskId');
  const profileId = readRequiredString(input.profileId, 'profileId');

  // Policy first: an account the org refuses for this project must be refused
  // whatever the task turns out to be, and the refusal reason is what the agent
  // gets to read.
  deps.policy.assertProfileAllowed(scope.projectPath, profileId);
  requireTaskInScope(deps, scope, taskId);

  const task = await deps.tasks.updateTask(taskId, { assignee_profile_id: profileId });
  deps.broadcast(task, 'updated');
  return { task };
}

function taskEvidenceAdd(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): { evidence: TaskEvidenceRow } {
  const taskId = readRequiredString(input.taskId, 'taskId');
  const kind = readEvidenceKind(input.kind, 'kind');
  const content = readRequiredString(input.content, 'content');
  const task = requireTaskInScope(deps, scope, taskId);

  const evidence = deps.tasks.addEvidence(taskId, { kind, content });
  // Evidence is not part of TaskRow, so the broadcast just tells open boards
  // to refetch this task's detail — the same signal an attachment/evidence
  // mutation sends over the REST API.
  deps.broadcast(task, 'updated');
  return { evidence };
}

/**
 * The box a listing reads, defaulting to the inbox.
 *
 * Read here rather than in the messages module because it decides *which*
 * service call happens: pulling an inbox is what marks its queued messages
 * delivered, while reading an outbox must never change anything.
 */
function readMessageBox(value: unknown): MessageBox {
  if (value === undefined || value === null || value === '') {
    return 'inbox';
  }
  const box = readRequiredString(value, 'box');
  if (!MESSAGE_BOXES.includes(box as MessageBox)) {
    throw new AgentBridgeValidationError(`box must be one of: ${MESSAGE_BOXES.join(', ')}`);
  }
  return box as MessageBox;
}

function messageSend(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): { message: AgentMessageRow } {
  // The sender is the token's session, never a field of the request: an agent
  // cannot post a handoff as somebody else.
  return { message: deps.messages.send(scope.sessionId, input) };
}

/**
 * Lists one side of the caller's mailbox.
 *
 * Reading the inbox *is* the delivery event — there is no way to push a message
 * into a running agent's context, so the queued messages this call returns come
 * back marked `delivered`.
 */
function messageList(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): { box: MessageBox; messages: AgentMessageRow[] } {
  const box = readMessageBox(input.box);
  const messages =
    box === 'inbox'
      ? deps.messages.pullInbox(scope.sessionId, { state: input.state })
      : deps.messages.list(scope.sessionId, { box, state: input.state });

  return { box, messages };
}

function messageAck(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): { message: AgentMessageRow } {
  return { message: deps.messages.acknowledge(scope.sessionId, input.messageId) };
}

function messageAnswer(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): AgentMessageAnswer {
  return deps.messages.answer(scope.sessionId, input.messageId, input);
}

async function profileRecommend(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): Promise<{ recommendation: Awaited<ReturnType<AgentBridgeToolDeps['recommend']['recommend']>> }> {
  const recommendation = await deps.recommend.recommend(
    scope.projectPath,
    readOptionalProvider(input.provider),
  );
  return { recommendation };
}

/**
 * Runs one bridge tool inside an already-authenticated session scope.
 *
 * Throws named `AppError`s only; the caller maps them to HTTP.
 */
export async function runAgentBridgeTool(
  toolName: string,
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): Promise<unknown> {
  switch (toolName) {
    case 'task_create':
      return taskCreate(input, scope, deps);
    case 'task_list':
      return taskList(input, scope, deps);
    case 'task_update_stage':
      return taskUpdateStage(input, scope, deps);
    case 'task_update_description':
      return taskUpdateDescription(input, scope, deps);
    case 'task_assign':
      return taskAssign(input, scope, deps);
    case 'task_evidence_add':
      return taskEvidenceAdd(input, scope, deps);
    case 'message_send':
      return messageSend(input, scope, deps);
    case 'message_list':
      return messageList(input, scope, deps);
    case 'message_ack':
      return messageAck(input, scope, deps);
    case 'message_answer':
      return messageAnswer(input, scope, deps);
    case 'profile_recommend':
      return profileRecommend(input, scope, deps);
    default:
      throw new AgentBridgeUnknownToolError(toolName);
  }
}
