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
export {
  handoffService,
  switchSessionProfile,
  drainPendingSwitch,
  markSessionRunning,
  markSessionIdle,
  type HandoffResult,
  type HandoffStatus,
} from '@/modules/profiles/handoff.service.js';
