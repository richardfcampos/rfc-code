// agentMessagesRoutes: used by the server entrypoint to mount the read-only inbox API at `/api/agent-messages`.
// agentMessagesService: used by the agent-bridge module's MCP tools
// (message_send, message_list, message_ack, message_answer).
export { agentMessagesRoutes, agentMessagesService } from './agent-messages.module.js';

export type {
  AgentMessageAnswer,
  AgentMessageRequestBody,
  AgentMessagesService,
} from './agent-messages.service.js';
export {
  AgentMessageInvalidTransitionError,
  AgentMessageNotFoundError,
  AgentMessageRecipientUnknownError,
  AgentMessageValidationError,
} from './agent-messages.errors.js';
// broadcastAgentMessageUpdate: exported for symmetry with the tasks module, so a
// future surface that mutates a handoff outside this module can reach clients
// the same way.
export { broadcastAgentMessageUpdate } from './agent-message-broadcast.js';
export type { AgentMessageUpdateAction } from './agent-message-broadcast.js';
export { AGENT_MESSAGE_STATES, canTransition, isTerminalAgentMessageState } from './agent-messages.state.js';
