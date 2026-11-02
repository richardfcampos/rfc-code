import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { mcpServerTools } from './providers-mcp.tools.js';
import { optBool, optStr, PROJECT_ID, PROVIDERS, S, schema, seg, str, tool, ToolInputError } from './tool-helpers.js';

const PROVIDER = S.enumOf(PROVIDERS, 'Provider id.');

function providerPath(args: JsonObject, suffix: string): string {
  return `/api/providers/${seg(str(args, 'provider'))}${suffix}`;
}

/** Skill entries are nested records; only the shape the server cannot report usefully is checked here. */
function skillEntries(args: JsonObject): JsonObject[] {
  const value = args.entries;
  const valid =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry));
  if (!valid) {
    throw new ToolInputError('entries must be a non-empty array of objects.');
  }
  return value as JsonObject[];
}

const SKILL_ENTRY = schema(
  {
    content: S.string('Markdown content of the skill file (SKILL.md style, with frontmatter).'),
    directoryName: S.string('Folder name for the skill; derived from the content when omitted.'),
    fileName: S.string('Main file name; defaults to the provider convention.'),
    files: S.array(
      schema(
        {
          relativePath: S.string('Path of the extra file inside the skill folder.'),
          content: S.string('File content, encoded as declared in encoding.'),
          encoding: S.enumOf(['utf8', 'base64'], 'How content is encoded.'),
        },
        ['relativePath', 'content', 'encoding'],
      ),
      'Extra files stored next to the main skill file.',
    ),
  },
  ['content'],
);

const coreTools: ToolDefinition[] = [
  tool({
    name: 'provider_auth_status',
    description: 'Check whether a provider CLI is installed and authenticated (email and login method).',
    inputSchema: schema({ provider: PROVIDER }, ['provider']),
    covers: ['GET /api/providers/:provider/auth/status'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: providerPath(args, '/auth/status') }),
  }),
  tool({
    name: 'provider_models',
    description: 'List the models a provider offers for new sessions. bypassCache=true refreshes the list.',
    inputSchema: schema({ provider: PROVIDER, bypassCache: S.boolean('Skip the cached model list.') }, ['provider']),
    covers: ['GET /api/providers/:provider/models'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'GET',
        path: providerPath(args, '/models'),
        query: { bypassCache: optBool(args, 'bypassCache') },
      }),
  }),
  tool({
    name: 'provider_capabilities',
    description: 'What a provider supports (effort levels, permission modes, features). Without provider, returns every provider.',
    inputSchema: schema({ provider: S.enumOf(PROVIDERS, 'Provider id; omit for all providers.') }),
    covers: ['GET /api/providers/capabilities', 'GET /api/providers/:provider/capabilities'],
    run: (args, ctx) => {
      const provider = optStr(args, 'provider')?.trim();
      const path = provider ? `/api/providers/${seg(provider)}/capabilities` : '/api/providers/capabilities';
      return ctx.api.dispatch({ method: 'GET', path });
    },
  }),
  tool({
    name: 'skill_list',
    description: 'List the skills a provider can load, optionally including those of a workspace or profile.',
    inputSchema: schema(
      {
        provider: PROVIDER,
        workspacePath: S.string('Absolute workspace path to include project-level skills.'),
        profileId: S.string('Profile id whose skills directory is inspected.'),
      },
      ['provider'],
    ),
    covers: ['GET /api/providers/:provider/skills'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'GET',
        path: providerPath(args, '/skills'),
        query: { workspacePath: optStr(args, 'workspacePath'), profileId: optStr(args, 'profileId') },
      }),
  }),
  tool({
    name: 'skill_create',
    description: 'Install one or more skills for a provider by writing their markdown (and optional extra files) to disk.',
    inputSchema: schema(
      { provider: PROVIDER, entries: S.array(SKILL_ENTRY, 'Skills to create; at least one.') },
      ['provider', 'entries'],
    ),
    covers: ['POST /api/providers/:provider/skills'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'POST', path: providerPath(args, '/skills'), body: { entries: skillEntries(args) } }),
  }),
  tool({
    name: 'skill_delete',
    description: 'Delete an installed skill folder of a provider (directoryName comes from skill_list).',
    inputSchema: schema({ provider: PROVIDER, directoryName: S.string('Skill folder name.') }, ['provider', 'directoryName']),
    covers: ['DELETE /api/providers/:provider/skills/:directoryName'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'DELETE', path: providerPath(args, `/skills/${seg(str(args, 'directoryName'))}`) }),
  }),
  tool({
    name: 'cursor_config',
    description: 'Read the Cursor CLI configuration (permissions and settings) of the host.',
    inputSchema: schema({}),
    covers: ['GET /api/cursor/config'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/cursor/config' }),
  }),
  tool({
    name: 'taskmaster_mcp_server_status',
    description: 'Report whether the Task Master MCP server is configured for the providers, optionally for one project.',
    inputSchema: schema({ projectId: PROJECT_ID }),
    covers: ['GET /api/mcp-utils/taskmaster-server'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'GET',
        path: '/api/mcp-utils/taskmaster-server',
        query: { projectId: optStr(args, 'projectId') },
      }),
  }),
];

export const providerTools: ToolDefinition[] = [...coreTools, ...mcpServerTools];
