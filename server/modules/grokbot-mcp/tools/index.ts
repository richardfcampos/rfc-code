/**
 * The tool registry: every section's tools, concatenated and checked once.
 *
 * The invariants here are the ones a client would otherwise discover at call
 * time — a duplicated name silently shadows a tool, a required argument that
 * is not in `properties` can never be supplied — so building the registry
 * throws instead of serving a broken `tools/list`.
 */

import type { ToolDefinition } from '../grokbot-mcp.types.js';
import type { ToolRegistry } from '../grokbot-mcp.jsonrpc.js';

import { assetTools } from './assets.tools.js';
import { automationTools } from './automations.tools.js';
import { chatTools } from './chat.tools.js';
import { collabTeamTools } from './collab-team.tools.js';
import { commandTools } from './commands.tools.js';
import { fileTools } from './files.tools.js';
import { gitTools } from './git.tools.js';
import { orgTools } from './orgs.tools.js';
import { pluginTools } from './plugins.tools.js';
import { profileTools } from './profiles.tools.js';
import { projectTools } from './projects.tools.js';
import { providerTools } from './providers.tools.js';
import { reviewTools } from './reviews.tools.js';
import { sessionSummaryTools } from './session-summary.tools.js';
import { sessionWebhookTools } from './session-webhooks.tools.js';
import { sessionTools } from './sessions.tools.js';
import { settingsTools } from './settings.tools.js';
import { systemTools } from './system.tools.js';
import { taskTools } from './tasks.tools.js';
import { taskmasterTools } from './taskmaster.tools.js';
import { worktreeTools } from './worktrees.tools.js';

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const MIN_DESCRIPTION_LENGTH = 20;

export function collectToolDefinitions(): ToolDefinition[] {
  return [
    ...systemTools,
    ...projectTools,
    ...fileTools,
    ...sessionTools,
    ...chatTools,
    ...sessionSummaryTools,
    ...sessionWebhookTools,
    ...worktreeTools,
    ...gitTools,
    ...taskTools,
    ...reviewTools,
    ...automationTools,
    ...orgTools,
    ...profileTools,
    ...providerTools,
    ...pluginTools,
    ...settingsTools,
    ...collabTeamTools,
    ...taskmasterTools,
    ...commandTools,
    ...assetTools,
  ];
}

/** Throws on the first invariant a definition breaks; exported for the registry test. */
export function assertToolInvariants(definitions: ToolDefinition[]): void {
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (!TOOL_NAME_PATTERN.test(definition.name)) {
      throw new Error(`Tool name "${definition.name}" must be snake_case.`);
    }
    if (seen.has(definition.name)) {
      throw new Error(`Duplicate tool name "${definition.name}".`);
    }
    seen.add(definition.name);
    if (definition.description.trim().length < MIN_DESCRIPTION_LENGTH) {
      throw new Error(`Tool "${definition.name}" needs a description of at least ${MIN_DESCRIPTION_LENGTH} characters.`);
    }
    if (definition.inputSchema.type !== 'object' || typeof definition.inputSchema.properties !== 'object') {
      throw new Error(`Tool "${definition.name}" inputSchema must be an object schema.`);
    }
    for (const key of definition.inputSchema.required ?? []) {
      if (!(key in definition.inputSchema.properties)) {
        throw new Error(`Tool "${definition.name}" requires "${key}" which is not in properties.`);
      }
    }
    for (const route of definition.covers) {
      if (!/^(GET|POST|PUT|PATCH|DELETE|ALL) \/(api|health)/.test(route)) {
        throw new Error(`Tool "${definition.name}" covers malformed route "${route}".`);
      }
    }
  }
}

export function createToolRegistry(definitions: ToolDefinition[] = collectToolDefinitions()): ToolRegistry {
  assertToolInvariants(definitions);
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  return {
    list: () => definitions,
    get: (name) => byName.get(name),
  };
}
