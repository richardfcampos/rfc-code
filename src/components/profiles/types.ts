import type { LLMProvider } from '../../types/app';

// Account profile: an isolated, per-provider credential dir the user can
// authenticate independently (HUB-05 multi-account).
// Response-compression levels, in increasing order. `off` is a real level, not
// the absence of one: a session uses it to override a compressing profile
// default back down.
export const CAVEMAN_MODES = ['off', 'lite', 'full', 'ultra'] as const;
export type CavemanMode = (typeof CAVEMAN_MODES)[number];

// Command-rewriting levels. Fewer than caveman has, because RTK exposes flags
// rather than a persistent mode — inventing parity would be inventing options.
export const RTK_MODES = ['off', 'normal', 'ultra-compact'] as const;
export type RtkMode = (typeof RTK_MODES)[number];

export interface Profile {
  id: string;
  provider: LLMProvider;
  name: string;
  slug: string;
  createdAt: string;
  // null means never configured here, which is distinct from `off`: the plugin
  // keeps following its own configuration instead of being pinned by this app.
  cavemanMode: CavemanMode | null;
  rtkMode: RtkMode | null;
  // Whether a new session of this provider falls back to this account when the
  // user picked none. At most one profile per provider carries it.
  isDefault: boolean;
  // Whether this account has been signed in. Carried by the list endpoint so a
  // caller rendering many accounts can disable the unusable ones without one
  // status request per row.
  authenticated: boolean;
}

export interface ProfileAuthStatus {
  authenticated: boolean;
}

// Plan-limit utilization for the account behind a profile, normalized by the
// backend across providers (see server/modules/profiles/usage).
export interface ProfileUsageWindow {
  id: string;
  label: string;
  utilization: number;
  resetsAt: string | null;
}

export type ProfileUsageStatus = 'ok' | 'unauthenticated' | 'unavailable';

export interface ProfileUsageSnapshot {
  supported: boolean;
  status: ProfileUsageStatus;
  windows: ProfileUsageWindow[];
  plan: string | null;
  // For codex this is the last recorded session event, which can be stale.
  asOf: string | null;
  fetchedAt: string;
}

// A profile plus its lazily-loaded auth status, as rendered by the profiles
// page and consumed by the chat profile selector.
export interface ProfileWithStatus extends Profile {
  status: ProfileAuthStatus | null;
  statusLoading: boolean;
}

export type CreateProfileInput = {
  provider: LLMProvider;
  name: string;
};

// Org: groups projects (by path-prefix/name rule) under a set of profiles the
// resolver is allowed to spawn there (AD C4 — a company's account must never
// leak into another company's projects; personal stays a fallback everywhere).
export const ORG_RULE_KINDS = ['path_prefix', 'project_name'] as const;
export type OrgRuleKind = (typeof ORG_RULE_KINDS)[number];

export const ORG_PROFILE_ROLES = ['primary', 'fallback'] as const;
export type OrgProfileRole = (typeof ORG_PROFILE_ROLES)[number];

export interface OrgRule {
  id: string;
  kind: OrgRuleKind;
  pattern: string;
}

// A profile absent from `policies` is implicitly not allowed in the org, once
// the org has at least one policy — see `Org.policies` below.
export interface OrgProfilePolicy {
  profileId: string;
  role: OrgProfileRole;
  priority: number;
}

export interface Org {
  id: string;
  name: string;
  // Catch-all org for projects matching no rule. Exactly one exists; it
  // cannot be deleted.
  isDefault: boolean;
  // Usage % (50-99) at or above which a primary is considered unavailable and
  // a fallback profile becomes eligible.
  fallbackThreshold: number;
  rules: OrgRule[];
  // Empty list is the compatibility path: every profile is allowed. Once
  // non-empty, only listed profiles may run here.
  policies: OrgProfilePolicy[];
}

export type CreateOrgInput = {
  name: string;
  fallbackThreshold?: number;
};

export type UpdateOrgInput = {
  name?: string;
  fallbackThreshold?: number;
};

export type CreateOrgRuleInput = {
  kind: OrgRuleKind;
  pattern: string;
};
