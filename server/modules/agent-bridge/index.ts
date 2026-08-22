/**
 * Public surface of the Agent Bridge module.
 *
 * Two routers (agent-facing tools, UI-facing token minting) are mounted by the
 * server entrypoint. `mintAgentBridgeToken` is exported for the spawn path: a
 * session that registers the MCP server for itself needs the same credential
 * the REST endpoint hands to the UI.
 */

export {
  agentBridgeRoutes,
  agentBridgeSessionTokenRoutes,
  mintAgentBridgeToken,
} from './agent-bridge.module.js';

export type { AgentBridgeMcpRegistration, AgentBridgeSessionScope } from './agent-bridge.types.js';
