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
}

export interface ProfileAuthStatus {
  authenticated: boolean;
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
