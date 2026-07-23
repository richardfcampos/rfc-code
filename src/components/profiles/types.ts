import type { LLMProvider } from '../../types/app';

// Account profile: an isolated, per-provider credential dir the user can
// authenticate independently (HUB-05 multi-account).
export interface Profile {
  id: string;
  provider: LLMProvider;
  name: string;
  slug: string;
  createdAt: string;
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
