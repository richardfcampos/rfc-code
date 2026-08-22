/**
 * Composition root of the Orgs module.
 *
 * The only file that binds the policy engine to real storage, the real profile
 * registry and the real plan-usage source; every service below stays a pure
 * function of its injected ports so policy decisions can be tested exhaustively
 * without touching a database or the network.
 */

import { getConnection, orgsDb, tasksDb } from '@/modules/database/index.js';
import { profilesService, profileUsageService } from '@/modules/profiles/index.js';
import { createOrgsRouter } from '@/modules/orgs/orgs.routes.js';
import { createOrgAdminService } from '@/modules/orgs/services/org-admin.service.js';
import { resolveOrgForProject } from '@/modules/orgs/services/org-resolver.service.js';
import {
  assertProfileAllowed,
  listAllowedProfiles,
  resolveProfileForSpawn,
} from '@/modules/orgs/services/profile-policy.service.js';
import { recommend } from '@/modules/orgs/services/profile-recommend.service.js';
import type {
  OrgPolicyDeps,
  OrgPolicyService,
  OrgRecommendService,
  OrgResolverService,
} from '@/modules/orgs/orgs.types.js';

const deps: OrgPolicyDeps = {
  orgs: orgsDb,
  profiles: {
    listProfiles: () => profilesService.listProfiles(),
  },
  usage: {
    getUsage: (profileId) => profileUsageService.getUsage(profileId),
  },
  audit: tasksDb.fallbackAudit,
};

export const orgResolverService: OrgResolverService = {
  resolveOrgForProject: (projectPath, projectName) =>
    resolveOrgForProject(projectPath, projectName, deps),
};

export const orgPolicyService: OrgPolicyService = {
  listAllowedProfiles: (projectPath, options = {}) =>
    listAllowedProfiles(projectPath, options, deps),
  assertProfileAllowed: (projectPath, profileId) =>
    assertProfileAllowed(projectPath, profileId, deps),
  resolveProfileForSpawn: (projectPath, options = {}) =>
    resolveProfileForSpawn(projectPath, options, deps),
};

export const orgRecommendService: OrgRecommendService = {
  recommend: (projectPath, provider, options = {}) =>
    recommend(projectPath, provider, options, deps),
};

/**
 * Configuration writes for orgs, project rules and profile policies.
 *
 * The transaction port is bound here rather than in the service: replacing an
 * allow-list has to be atomic, and the connection is this file's business.
 */
export const orgAdminService = createOrgAdminService({
  repository: orgsDb,
  runInTransaction: (work) => getConnection().transaction(work)(),
  listProfileIds: () => profilesService.listProfiles().map((profile) => profile.id),
});

/** Orgs router mounted by the server entrypoint at `/api/orgs`. */
export const orgsRoutes = createOrgsRouter({
  admin: orgAdminService,
  policy: orgPolicyService,
  recommend: orgRecommendService,
});
