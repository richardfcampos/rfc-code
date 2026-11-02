import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { optStr, pick, PROVIDERS, S, schema, seg, str, tool, ToolInputError } from './tool-helpers.js';

const ORG_ID = S.string('Organization id, as returned by org_list.');
const PROJECT_FILTER = S.string('Absolute project path used to resolve the organization; omit for the default organization.');
const PROVIDER_FILTER = S.enumOf(PROVIDERS, 'Restrict the answer to one provider; omit for all providers.');
const FALLBACK_THRESHOLD = S.number('Usage percentage at which spawns move from primary to fallback profiles.');

function orgPath(args: JsonObject, suffix = ''): string {
  return `/api/orgs/${seg(str(args, 'orgId'))}${suffix}`;
}

function policyEntries(args: JsonObject): JsonObject[] {
  const value = args.policies;
  const valid =
    Array.isArray(value) &&
    value.every((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry));
  if (!valid) {
    throw new ToolInputError('policies must be an array of objects.');
  }
  return value as JsonObject[];
}

export const orgTools: ToolDefinition[] = [
  tool({
    name: 'org_list',
    description: 'List organizations with their project rules and profile policies (primary/fallback accounts).',
    inputSchema: schema({}),
    covers: ['GET /api/orgs'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/orgs' }),
  }),
  tool({
    name: 'org_create',
    description: 'Create an organization that groups projects and decides which profiles (accounts) may serve them.',
    inputSchema: schema({ name: S.string('Organization name.'), fallbackThreshold: FALLBACK_THRESHOLD }, ['name']),
    covers: ['POST /api/orgs'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'POST', path: '/api/orgs', body: { name: str(args, 'name'), ...pick(args, ['fallbackThreshold']) } }),
  }),
  tool({
    name: 'org_update',
    description: 'Rename an organization or change its fallback threshold; only the given fields change.',
    inputSchema: schema({ orgId: ORG_ID, name: S.string('New name.'), fallbackThreshold: FALLBACK_THRESHOLD }, ['orgId']),
    covers: ['PATCH /api/orgs/:id'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'PATCH', path: orgPath(args), body: pick(args, ['name', 'fallbackThreshold']) }),
  }),
  tool({
    name: 'org_delete',
    description: 'Delete an organization together with its project rules and profile policies.',
    inputSchema: schema({ orgId: ORG_ID }, ['orgId']),
    covers: ['DELETE /api/orgs/:id'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: orgPath(args) }),
  }),
  tool({
    name: 'org_rule_add',
    description:
      'Attach a project rule to an organization: projects whose absolute path starts with the pattern (path_prefix) or whose name equals it (project_name) belong to the org.',
    inputSchema: schema(
      {
        orgId: ORG_ID,
        kind: S.enumOf(['path_prefix', 'project_name'], 'How the pattern is matched.'),
        pattern: S.string('Path prefix or project name to match.'),
      },
      ['orgId', 'kind', 'pattern'],
    ),
    covers: ['POST /api/orgs/:id/rules'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'POST',
        path: orgPath(args, '/rules'),
        body: { kind: str(args, 'kind'), pattern: str(args, 'pattern') },
      }),
  }),
  tool({
    name: 'org_rule_delete',
    description: 'Remove one project rule from an organization (rule ids come from org_list).',
    inputSchema: schema({ orgId: ORG_ID, ruleId: S.string('Rule id from org_list.') }, ['orgId', 'ruleId']),
    covers: ['DELETE /api/orgs/:id/rules/:ruleId'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'DELETE', path: orgPath(args, `/rules/${seg(str(args, 'ruleId'))}`) }),
  }),
  tool({
    name: 'org_policies_replace',
    description:
      'Replace the whole profile allow-list of an organization. Pass the full desired set; anything omitted is removed. Each entry is {profileId, role: primary|fallback, priority?}.',
    inputSchema: schema(
      {
        orgId: ORG_ID,
        policies: S.array(
          schema(
            {
              profileId: S.string('Profile id from profile_list.'),
              role: S.enumOf(['primary', 'fallback'], 'Primary accounts are used first; fallbacks past the threshold.'),
              priority: S.integer('Lower numbers are tried first within a role.'),
            },
            ['profileId', 'role'],
          ),
          'Complete set of profile policies for the organization.',
        ),
      },
      ['orgId', 'policies'],
    ),
    covers: ['PUT /api/orgs/:id/policies'],
    // The route reads the request body itself as the array, not a wrapper object.
    run: (args, ctx) => ctx.api.dispatch({ method: 'PUT', path: orgPath(args, '/policies'), body: policyEntries(args) }),
  }),
  tool({
    name: 'org_allowed_profiles',
    description: 'List the profiles a spawn for this project/provider would be allowed to use under organization policy.',
    inputSchema: schema({ project: PROJECT_FILTER, provider: PROVIDER_FILTER }),
    covers: ['GET /api/orgs/allowed-profiles'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'GET',
        path: '/api/orgs/allowed-profiles',
        query: { project: optStr(args, 'project'), provider: optStr(args, 'provider') },
      }),
  }),
  tool({
    name: 'org_recommend_profile',
    description: 'Ask which profile to use for a project/provider right now, with its role, usage percentage and the reason.',
    inputSchema: schema({ project: PROJECT_FILTER, provider: PROVIDER_FILTER }),
    covers: ['GET /api/orgs/recommend'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'GET',
        path: '/api/orgs/recommend',
        query: { project: optStr(args, 'project'), provider: optStr(args, 'provider') },
      }),
  }),
];
