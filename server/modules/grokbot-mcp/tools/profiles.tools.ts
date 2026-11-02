import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { optBool, optStr, PROVIDERS, S, schema, seg, str, tool, ToolInputError } from './tool-helpers.js';

const PROFILE_ID = S.string('Profile id, as returned by profile_list.');

function profilePath(args: JsonObject, suffix = ''): string {
  return `/api/profiles/${seg(str(args, 'profileId'))}${suffix}`;
}

/** Unlike `strArray`, an empty list is meaningful here: it disables every optional skill. */
function skillNames(args: JsonObject): string[] {
  const value = args.enabled;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ToolInputError('enabled must be an array of strings.');
  }
  return value as string[];
}

/** A key set to null clears that level; a key left out stays untouched, so both are forwarded as given. */
function toolingBody(args: JsonObject): JsonObject {
  const body: JsonObject = {};
  for (const key of ['cavemanMode', 'rtkMode']) {
    if (key in args && args[key] !== undefined) {
      body[key] = args[key];
    }
  }
  return body;
}

export const profileTools: ToolDefinition[] = [
  tool({
    name: 'profile_list',
    description: 'List provider accounts (profiles) with id, provider, default flag, tooling modes and authentication state.',
    inputSchema: schema({ provider: S.enumOf(PROVIDERS, 'Only profiles of this provider.') }),
    covers: ['GET /api/profiles'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'GET', path: '/api/profiles', query: { provider: optStr(args, 'provider') } }),
  }),
  tool({
    name: 'profile_create',
    description: 'Create a new profile (isolated account/config directory) for a provider.',
    inputSchema: schema(
      { provider: S.enumOf(PROVIDERS, 'Provider the profile belongs to.'), name: S.string('Display name for the profile.') },
      ['provider', 'name'],
    ),
    covers: ['POST /api/profiles'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'POST', path: '/api/profiles', body: { provider: str(args, 'provider'), name: str(args, 'name') } }),
  }),
  tool({
    name: 'profile_delete',
    description: 'Delete a profile and its stored configuration.',
    inputSchema: schema({ profileId: PROFILE_ID }, ['profileId']),
    covers: ['DELETE /api/profiles/:id'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: profilePath(args) }),
  }),
  tool({
    name: 'profile_status',
    description: 'Check whether a profile is authenticated with its provider.',
    inputSchema: schema({ profileId: PROFILE_ID }, ['profileId']),
    covers: ['GET /api/profiles/:id/status'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: profilePath(args, '/status') }),
  }),
  tool({
    name: 'profile_set_default',
    description: 'Make a profile the default for new sessions of its provider (isDefault=true) or demote it. Promoting demotes the previous default.',
    inputSchema: schema({ profileId: PROFILE_ID, isDefault: S.boolean('True to promote, false to demote.') }, ['profileId', 'isDefault']),
    covers: ['PATCH /api/profiles/:id/default'],
    run: (args, ctx) => {
      const isDefault = optBool(args, 'isDefault');
      if (isDefault === undefined) {
        throw new ToolInputError('isDefault is required.');
      }
      return ctx.api.dispatch({ method: 'PATCH', path: profilePath(args, '/default'), body: { isDefault } });
    },
  }),
  tool({
    name: 'profile_set_tooling',
    description:
      'Set the output-compression levels of a profile: cavemanMode (off|lite|full|ultra) and rtkMode (off|normal|ultra-compact). Pass null to clear a level back to unconfigured; omitted keys are untouched.',
    inputSchema: schema(
      {
        profileId: PROFILE_ID,
        cavemanMode: { type: ['string', 'null'], enum: ['off', 'lite', 'full', 'ultra', null], description: 'Caveman level, or null to clear.' },
        rtkMode: { type: ['string', 'null'], enum: ['off', 'normal', 'ultra-compact', null], description: 'RTK level, or null to clear.' },
      },
      ['profileId'],
    ),
    covers: ['PATCH /api/profiles/:id/tooling'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'PATCH', path: profilePath(args, '/tooling'), body: toolingBody(args) }),
  }),
  tool({
    name: 'profile_usage',
    description:
      'Plan-usage snapshot (quota percentages) for one profile when profileId is given, otherwise for every profile. force=true bypasses the cache.',
    inputSchema: schema({ profileId: S.string('Profile id; omit for all profiles.'), force: S.boolean('Skip cached usage data.') }),
    covers: ['GET /api/profiles/usage', 'GET /api/profiles/:id/usage'],
    run: (args, ctx) => {
      const profileId = optStr(args, 'profileId')?.trim();
      const force = optBool(args, 'force');
      if (profileId) {
        return ctx.api.dispatch({ method: 'GET', path: `/api/profiles/${seg(profileId)}/usage`, query: { force } });
      }
      return ctx.api.dispatch({ method: 'GET', path: '/api/profiles/usage', query: { force } });
    },
  }),
  tool({
    name: 'profile_skills',
    description: 'List the skills bundled with a profile and which of them are currently enabled.',
    inputSchema: schema({ profileId: PROFILE_ID }, ['profileId']),
    covers: ['GET /api/profiles/:id/skills'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: profilePath(args, '/skills') }),
  }),
  tool({
    name: 'profile_skills_set',
    description: 'Set the full list of enabled optional skills for a profile (names from profile_skills). An empty list disables all optional skills.',
    inputSchema: schema(
      { profileId: PROFILE_ID, enabled: S.stringArray('Skill names to keep enabled; replaces the previous selection.') },
      ['profileId', 'enabled'],
    ),
    covers: ['PUT /api/profiles/:id/skills'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'PUT', path: profilePath(args, '/skills'), body: { enabled: skillNames(args) } }),
  }),
  tool({
    name: 'profile_skills_restore',
    description: 'Re-install every bundled skill into a profile; the repair path for profiles created before skills were bundled.',
    inputSchema: schema({ profileId: PROFILE_ID }, ['profileId']),
    covers: ['POST /api/profiles/:id/skills/restore'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: profilePath(args, '/skills/restore') }),
  }),
];
