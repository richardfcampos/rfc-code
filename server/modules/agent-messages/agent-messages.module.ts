/**
 * Composition root of the Agent Messages module.
 *
 * The only file that binds the handoff inbox to real storage, the real session
 * registry and the real WebSocket fan-out; the service below stays a function
 * of injected ports so it can be tested without a socket or a live session.
 */

import { sessionsDb } from '@/modules/database/index.js';

import { broadcastAgentMessageUpdate } from './agent-message-broadcast.js';
import { createAgentMessagesRouter } from './agent-messages.routes.js';
import { createAgentMessagesService } from './agent-messages.service.js';

export const agentMessagesService = createAgentMessagesService({
  // A handoff is addressed to a session that must still exist right now:
  // queueing work for a session that is already gone would leave a message
  // nobody can ever deliver.
  sessionExists: (sessionId) => sessionsDb.getSessionById(sessionId) !== null,
  broadcast: broadcastAgentMessageUpdate,
});

export const agentMessagesRoutes = createAgentMessagesRouter(agentMessagesService);
