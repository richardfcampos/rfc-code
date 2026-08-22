export { profilesService } from '@/modules/profiles/profiles.service.js';
export type {
  CreateProfileInput,
  ProfileAuthStatus,
  ProfileView,
} from '@/modules/profiles/profiles.service.js';
export {
  getProfilesRoot,
  resolveCredentialPath,
  resolveProfileDir,
  resolveProviderEnv,
} from '@/modules/profiles/profile-env.js';
export {
  resolveProfileIdForPath,
  resolveProfileRootForPath,
  resolveProfileScanRoots,
  type ProfileScanRoot,
} from '@/modules/profiles/profile-sync.js';
export { consumePendingPrimer } from '@/modules/profiles/handoff-primer-consume.js';
export {
  renderConversationPrimer,
  type PrimerMessage,
} from '@/modules/profiles/handoff-primer.js';
export {
  configureHandoffSummaryRuntime,
  summarizeOverflow,
  type OverflowSummary,
} from '@/modules/profiles/handoff-primer-summarize.js';
// Plan-usage lives behind the barrel so quota-aware callers outside this module
// (the org policy engine) reach it without deep-importing profiles internals.
export { profileUsageService } from '@/modules/profiles/usage/profile-usage.service.js';
export type {
  ProfileUsageEnvelope,
  ProfileUsageSnapshot,
} from '@/modules/profiles/usage/profile-usage.types.js';
export {
  handoffService,
  switchSessionProfile,
  drainPendingSwitch,
  markSessionRunning,
  markSessionIdle,
  type HandoffResult,
  type HandoffStatus,
} from '@/modules/profiles/handoff.service.js';
