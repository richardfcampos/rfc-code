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
export {
  handoffService,
  switchSessionProfile,
  drainPendingSwitch,
  markSessionRunning,
  markSessionIdle,
  type HandoffResult,
  type HandoffStatus,
} from '@/modules/profiles/handoff.service.js';
