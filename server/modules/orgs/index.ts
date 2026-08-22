/**
 * Public surface of the Orgs module.
 *
 * Unlike Worktrees, the services themselves are exported: the spawn choke point
 * (WebSocket), the MCP bridge and the REST layer all have to ask the same
 * policy engine, and a barrel that exposed only routes would push them into
 * deep imports.
 */

export {
  orgPolicyService,
  orgRecommendService,
  orgResolverService,
} from '@/modules/orgs/orgs.module.js';

export { OrgPolicyError } from '@/modules/orgs/orgs.errors.js';

export type {
  AllowedProfile,
  AllowedProfilesResult,
  ListAllowedProfilesOptions,
  Org,
  OrgPolicyService,
  OrgProfileRole,
  OrgProjectRuleKind,
  OrgRecommendService,
  OrgResolverService,
  ProfileRecommendation,
  ResolveProfileForSpawnOptions,
  SpawnFallbackInfo,
  SpawnProfileSelection,
} from '@/modules/orgs/orgs.types.js';
