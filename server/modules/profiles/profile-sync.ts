/**
 * Helpers that make the provider session synchronizers profile-aware.
 *
 * Each provider CLI, when redirected at a profile's isolated config directory
 * by `resolveProviderEnv`, writes its session artifacts under a provider-
 * specific subpath of that directory. These helpers expose those per-profile
 * roots so a synchronizer can scan them (in addition to the default `~` home)
 * and stamp every discovered session with the profile that owns it.
 */

import path from 'node:path';

import type { LLMProvider } from '@/shared/types.js';
import { resolveProfileDir } from '@/modules/profiles/profile-env.js';
import { profilesService } from '@/modules/profiles/profiles.service.js';

export interface ProfileScanRoot {
  profileId: string;
  /** Directory the provider treats as its session/config home for this profile. */
  home: string;
}

/**
 * Maps a profile's base directory to the exact home the provider's synchronizer
 * scans — mirroring where each CLI lands its artifacts under the env override:
 *  - claude:   `CLAUDE_CONFIG_DIR` == profileDir            → `<home>/projects`
 *  - codex:    `CODEX_HOME` == profileDir                   → `<home>/sessions`
 *  - cursor:   `HOME` == profileDir, CLI home is `~/.cursor` → `<home>/projects`
 *  - opencode: `XDG_DATA_HOME` == profileDir/data, db under `opencode/`
 */
function resolveProviderHome(provider: LLMProvider, profileDir: string): string {
  switch (provider) {
    case 'claude':
    case 'codex':
      return profileDir;
    case 'cursor':
      return path.join(profileDir, '.cursor');
    case 'opencode':
      return path.join(profileDir, 'data', 'opencode');
    default: {
      const unsupported: never = provider;
      throw new Error(`No sync home defined for provider "${String(unsupported)}"`);
    }
  }
}

/** One scan root per registered profile of the provider. */
export function resolveProfileScanRoots(provider: LLMProvider): ProfileScanRoot[] {
  return profilesService.listProfiles(provider).map((profile) => ({
    profileId: profile.id,
    home: resolveProviderHome(provider, resolveProfileDir(provider, profile.slug)),
  }));
}

/**
 * Returns the profile scan root that owns an artifact path, or null when the
 * path is outside every profile home (i.e. a session under the provider's
 * default `~` config directory, which stays profile-less for upstream
 * compatibility).
 */
export function resolveProfileRootForPath(
  provider: LLMProvider,
  artifactPath: string,
): ProfileScanRoot | null {
  const normalized = path.resolve(artifactPath);
  for (const root of resolveProfileScanRoots(provider)) {
    const rootPath = path.resolve(root.home);
    if (normalized === rootPath || normalized.startsWith(rootPath + path.sep)) {
      return root;
    }
  }
  return null;
}

/** Convenience: the owning profile id for an artifact path, or null. */
export function resolveProfileIdForPath(
  provider: LLMProvider,
  artifactPath: string,
): string | null {
  return resolveProfileRootForPath(provider, artifactPath)?.profileId ?? null;
}
