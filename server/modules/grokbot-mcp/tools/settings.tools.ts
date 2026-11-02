/** Settings: API keys, stored credentials and git identity; plus the notification and Browser sub-sections. */

import type { ToolDefinition } from '../grokbot-mcp.types.js';

import { S, optStr, pick, schema, seg, str, tool } from './tool-helpers.js';
import { settingsBrowserUseTools } from './settings-browser-use.tools.js';
import { requiredBool, settingsNotificationTools } from './settings-notifications.tools.js';

const KEY_ID = S.string('API key id, as returned by api_key_list.');
const CREDENTIAL_ID = S.string('Credential id, as returned by credential_list.');

const accountTools: ToolDefinition[] = [
  tool({
    name: 'api_key_list',
    description: 'List the API keys that can authenticate against this server (values are masked).',
    inputSchema: schema({}),
    covers: ['GET /api/settings/api-keys'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/settings/api-keys' }),
  }),
  tool({
    name: 'api_key_create',
    description: 'Create an API key. The full key value is only present in this response, so hand it to the user right away.',
    inputSchema: schema({ keyName: S.string('Label for the key.') }, ['keyName']),
    covers: ['POST /api/settings/api-keys'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: '/api/settings/api-keys', body: { keyName: str(args, 'keyName') } }),
  }),
  tool({
    name: 'api_key_delete',
    description: 'Delete an API key permanently; clients using it lose access immediately.',
    inputSchema: schema({ keyId: KEY_ID }, ['keyId']),
    covers: ['DELETE /api/settings/api-keys/:keyId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: `/api/settings/api-keys/${seg(str(args, 'keyId'))}` }),
  }),
  tool({
    name: 'api_key_toggle',
    description: 'Activate or deactivate an API key without deleting it.',
    inputSchema: schema({ keyId: KEY_ID, isActive: S.boolean('New active state.') }, ['keyId', 'isActive']),
    covers: ['PATCH /api/settings/api-keys/:keyId/toggle'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'PATCH',
        path: `/api/settings/api-keys/${seg(str(args, 'keyId'))}/toggle`,
        body: { isActive: requiredBool(args, 'isActive') },
      }),
  }),
  tool({
    name: 'credential_list',
    description: 'List stored credentials (values are masked), optionally filtered by credential type.',
    inputSchema: schema({ type: S.string('Credential type filter.') }),
    covers: ['GET /api/settings/credentials'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/settings/credentials', query: { type: optStr(args, 'type') } }),
  }),
  tool({
    name: 'credential_create',
    description: 'Store a named credential (for example a token other tools may use).',
    inputSchema: schema(
      {
        credentialName: S.string('Credential name.'),
        credentialType: S.string('Credential type, e.g. "github_token".'),
        credentialValue: S.string('The secret value.'),
        description: S.string('Optional description.'),
      },
      ['credentialName', 'credentialType', 'credentialValue'],
    ),
    covers: ['POST /api/settings/credentials'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'POST',
        path: '/api/settings/credentials',
        body: {
          credentialName: str(args, 'credentialName'),
          credentialType: str(args, 'credentialType'),
          credentialValue: str(args, 'credentialValue'),
          ...pick(args, ['description']),
        },
      }),
  }),
  tool({
    name: 'credential_delete',
    description: 'Delete a stored credential permanently.',
    inputSchema: schema({ credentialId: CREDENTIAL_ID }, ['credentialId']),
    covers: ['DELETE /api/settings/credentials/:credentialId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: `/api/settings/credentials/${seg(str(args, 'credentialId'))}` }),
  }),
  tool({
    name: 'credential_toggle',
    description: 'Activate or deactivate a stored credential without deleting it.',
    inputSchema: schema({ credentialId: CREDENTIAL_ID, isActive: S.boolean('New active state.') }, ['credentialId', 'isActive']),
    covers: ['PATCH /api/settings/credentials/:credentialId/toggle'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'PATCH',
        path: `/api/settings/credentials/${seg(str(args, 'credentialId'))}/toggle`,
        body: { isActive: requiredBool(args, 'isActive') },
      }),
  }),
  tool({
    name: 'git_identity_get',
    description: 'Read the git user name and email configured for commits made by this server.',
    inputSchema: schema({}),
    covers: ['GET /api/user/git-config'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/user/git-config' }),
  }),
  tool({
    name: 'git_identity_set',
    description: 'Set the git user name and email used for commits made by this server.',
    inputSchema: schema({ gitName: S.string('Git user.name.'), gitEmail: S.string('Git user.email.') }, ['gitName', 'gitEmail']),
    covers: ['POST /api/user/git-config'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'POST',
        path: '/api/user/git-config',
        body: { gitName: str(args, 'gitName'), gitEmail: str(args, 'gitEmail') },
      }),
  }),
];

export const settingsTools: ToolDefinition[] = [...accountTools, ...settingsNotificationTools, ...settingsBrowserUseTools];
