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
