/**
 * Account profile registry.
 *
 * Owns the multi-account feature's business logic: creating a profile (and its
 * isolated on-disk config directory), listing/deleting profiles, resolving the
 * per-profile environment that isolates one account's credentials from another,
 * and reporting whether a profile has been logged in yet.
 */

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';
import { sessionsDb } from '@/modules/database/index.js';
import {
  resolveCredentialPath,
  resolveProfileDir,
  resolveProviderEnv,
} from '@/modules/profiles/profile-env.js';
import { repairPluginConfigPaths } from '@/modules/profiles/profile-plugin-path-repair.js';
import {
  profilesRepository,
  type ProfileRow,
} from '@/modules/profiles/profiles.repository.js';
import {
  applySkillSelection,
  enableAllSkills,
  listBundledSkills,
  listEnabledSkills,
  repairSkillLinks,
  type BundledSkill,
} from '@/modules/bundled-skills/index.js';
import {
  applyRtkMode,
  disableCavemanPlugin,
  enableCavemanPlugin,
  normalizeCavemanMode,
  normalizeRtkMode,
  resolveCavemanEnv,
  resolveExplicitCavemanMode,
  type CavemanMode,
  type RtkMode,
} from '@/modules/agent-tooling/index.js';

const SUPPORTED_PROVIDERS: readonly LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];

export interface ProfileView {
  id: string;
  provider: LLMProvider;
  name: string;
  slug: string;
  createdAt: string;
  /** Default compression level; null when never configured for this profile. */
  cavemanMode: CavemanMode | null;
  /** Command-rewriting level; null when never configured for this profile. */
  rtkMode: RtkMode | null;
  /** Whether new sessions of this provider fall back to this account. */
  isDefault: boolean;
  /** Whether this account has been signed in — see `isProfileAuthenticated`. */
  authenticated: boolean;
}

/**
 * Agent tooling is delivered as Claude Code plugins and hooks, so the toggles
 * are inert for every other provider. Callers use this to disable the controls
 * rather than offering a switch that quietly does nothing.
 */
export const AGENT_TOOLING_PROVIDER: LLMProvider = 'claude';

export function supportsAgentTooling(provider: LLMProvider): boolean {
  return provider === AGENT_TOOLING_PROVIDER;
}

export interface ProfileAuthStatus {
  authenticated: boolean;
}

export interface CreateProfileInput {
  provider: unknown;
  name: unknown;
}

/**
 * Single source of truth for "has this account been signed in".
 *
 * One existence check on the provider's login artifact — a single `stat`, no
 * read and no CLI call — which is why it is cheap enough to run for every row
 * of the profile list. Every caller (the list payload, the per-profile status
 * endpoint, the handoff guard) resolves through here: two independent copies of
 * this rule would let the UI offer an account the backend then refuses.
 */
function isProfileAuthenticated(row: ProfileRow): boolean {
  const credentialPath = resolveCredentialPath(
    row.provider,
    resolveProfileDir(row.provider, row.slug),
  );
  return fs.existsSync(credentialPath);
}

function toView(row: ProfileRow): ProfileView {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    cavemanMode: normalizeCavemanMode(row.caveman_mode),
    rtkMode: normalizeRtkMode(row.rtk_mode),
    isDefault: row.is_default === 1,
    authenticated: isProfileAuthenticated(row),
  };
}

/** Validates and narrows an untrusted provider value at the service boundary. */
export function assertSupportedProvider(value: unknown): LLMProvider {
  if (typeof value === 'string' && (SUPPORTED_PROVIDERS as readonly string[]).includes(value)) {
    return value as LLMProvider;
  }
  throw new AppError(`Unsupported provider "${String(value)}".`, {
    code: 'INVALID_PROVIDER',
    statusCode: 400,
  });
}

/** Turns a human name into a filesystem-safe directory slug. */
function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'profile';
}

/** Finds the first non-colliding slug for a provider (name-a, name-a-2, ...). */
function allocateSlug(provider: LLMProvider, name: string): string {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (profilesRepository.existsSlug(provider, candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export const profilesService = {
  createProfile(input: CreateProfileInput): ProfileView {
    const provider = assertSupportedProvider(input.provider);

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) {
      throw new AppError('Profile name is required.', {
        code: 'PROFILE_NAME_REQUIRED',
        statusCode: 400,
      });
    }

    const slug = allocateSlug(provider, name);
    const id = randomUUID();

    // Create the isolated config directory up front so the first session using
    // this profile has somewhere to land, and so a login can write into it.
    const profileDir = resolveProfileDir(provider, slug);
    fs.mkdirSync(profileDir, { recursive: true });

    // A new profile starts with the whole bundled toolbox: Claude Code only
    // finds skills under this config dir, so without this a fresh account sees
    // none at all and the skills panel would be the only way to get any.
    enableAllSkills(profileDir);

    const row = profilesRepository.insert({ id, provider, name, slug });
    return toView(row);
  },

  listProfiles(provider?: LLMProvider): ProfileView[] {
    return profilesRepository.list(provider).map(toView);
  },

  getProfile(id: string): ProfileView {
    return toView(loadProfileOrThrow(id));
  },

  deleteProfile(id: string): void {
    loadProfileOrThrow(id);

    // Sessions are detached rather than blocking the delete: a NULL profile_id
    // keeps them openable on the provider's default config directory.
    profilesRepository.detachSessions(id);

    // The row is removed but the on-disk credential directory is intentionally
    // left in place, so re-creating the same account reuses its existing login.
    profilesRepository.deleteById(id);
  },

  /**
   * Promotes or demotes this profile as its provider's fallback account.
   *
   * Scoped per provider because a profile only ever holds credentials for one
   * of them: a single global default would be unusable the moment the user
   * switches provider.
   */
  setDefaultProfile(profileId: string, isDefault: boolean): ProfileView {
    const row = loadProfileOrThrow(profileId);
    const updated = isDefault
      ? profilesRepository.setDefault(profileId, row.provider)
      : profilesRepository.clearDefault(profileId);
    return toView(updated ?? row);
  },

  /**
   * The account a new session of this provider uses when none was picked.
   *
   * Returns null when the provider has no default, which keeps the historical
   * behavior — the provider CLI's own config directory — for anyone who never
   * nominated one.
   */
  resolveDefaultProfileId(provider: LLMProvider): string | null {
    return profilesRepository.getDefault(provider)?.id ?? null;
  },

  /**
   * Resolves the environment variables that isolate one profile's credentials.
   *
   * A falsy `profileId` yields an empty object: sessions with no profile keep
   * the provider CLI's default config directory (upstream behavior). A profile
   * id that no longer exists is a hard error rather than a silent fallback to
   * some other account's credentials.
   */
  resolveEnv(profileId?: string | null): Record<string, string> {
    if (!profileId) {
      return {};
    }
    const row = loadProfileOrThrow(profileId);
    return resolveProviderEnv(row.provider, resolveProfileDir(row.provider, row.slug));
  },

  /**
   * Sets this profile's agent tooling levels.
   *
   * The RTK level is written to the profile's `settings.json` before the row is
   * updated: the file is what Claude Code actually reads, so persisting the
   * intent first would leave the UI claiming a level that no session honors if
   * the write then failed.
   */
  updateToolingModes(
    profileId: string,
    input: { cavemanMode?: unknown; rtkMode?: unknown },
  ): ProfileView {
    const row = loadProfileOrThrow(profileId);

    if (!supportsAgentTooling(row.provider)) {
      throw new AppError(
        `Agent tooling is only available for ${AGENT_TOOLING_PROVIDER} profiles, not "${row.provider}".`,
        { code: 'PROFILE_TOOLING_UNSUPPORTED', statusCode: 400 },
      );
    }

    const modes: { cavemanMode?: string | null; rtkMode?: string | null } = {};

    if ('cavemanMode' in input) {
      const mode = input.cavemanMode === null ? null : normalizeCavemanMode(input.cavemanMode);
      if (input.cavemanMode !== null && mode === null) {
        throw new AppError(`Unsupported caveman mode "${String(input.cavemanMode)}".`, {
          code: 'INVALID_CAVEMAN_MODE',
          statusCode: 400,
        });
      }
      // The level only takes effect if the plugin that reads it is enabled for
      // this profile's config dir, so registration happens here rather than
      // being assumed. `off` is still a real level — the session must be able
      // to override a profile default back up — so the plugin stays enabled
      // unless the level is cleared entirely.
      const profileDir = resolveProfileDir(row.provider, row.slug);
      if (mode === null) {
        disableCavemanPlugin(profileDir);
      } else {
        enableCavemanPlugin(profileDir);
      }
      modes.cavemanMode = mode;
    }

    if ('rtkMode' in input) {
      const mode = input.rtkMode === null ? null : normalizeRtkMode(input.rtkMode);
      if (input.rtkMode !== null && mode === null) {
        throw new AppError(`Unsupported RTK mode "${String(input.rtkMode)}".`, {
          code: 'INVALID_RTK_MODE',
          statusCode: 400,
        });
      }
      applyRtkMode(resolveProfileDir(row.provider, row.slug), mode ?? 'off');
      modes.rtkMode = mode;
    }

    const updated = profilesRepository.updateToolingModes(profileId, modes);
    return toView(updated ?? row);
  },

  /**
   * Sets or clears one session's compression override.
   *
   * `null` clears it, which is materially different from `off`: cleared means
   * "follow the profile" and keeps tracking later profile changes, while `off`
   * pins this session to no compression regardless of the profile.
   */
  updateSessionCavemanMode(
    sessionId: string,
    value: unknown,
  ): { sessionId: string; cavemanMode: CavemanMode | null } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const mode = value === null ? null : normalizeCavemanMode(value);
    if (value !== null && mode === null) {
      throw new AppError(`Unsupported caveman mode "${String(value)}".`, {
        code: 'INVALID_CAVEMAN_MODE',
        statusCode: 400,
      });
    }

    sessionsDb.updateSessionCavemanMode(sessionId, mode);
    return { sessionId, cavemanMode: mode };
  },

  /**
   * Environment that configures agent tooling for one dispatched session.
   *
   * Returns nothing when the provider does not support it, and nothing when
   * neither the session nor its profile ever chose a level — see
   * `resolveExplicitCavemanMode` for why an unconfigured session must stay out
   * of the plugin's way instead of injecting a computed default.
   */
  resolveToolingEnv(
    profileId?: string | null,
    sessionCavemanMode?: string | null,
  ): Record<string, string> {
    const row = profileId ? loadProfileOrThrow(profileId) : null;

    if (row && !supportsAgentTooling(row.provider)) {
      return {};
    }

    const mode = resolveExplicitCavemanMode(sessionCavemanMode, row?.caveman_mode);
    return mode ? resolveCavemanEnv(mode) : {};
  },

  /**
   * Lists every bundled skill alongside whether this profile exposes it.
   */
  listSkills(profileId: string): { skills: BundledSkill[]; enabled: string[] } {
    const row = loadProfileOrThrow(profileId);
    const profileDir = resolveProfileDir(row.provider, row.slug);
    return { skills: listBundledSkills(), enabled: listEnabledSkills(profileDir) };
  },

  /**
   * Replaces this profile's skill selection wholesale.
   *
   * Takes the full desired set rather than a single toggle so a selection can
   * never be applied half-way, and so two concurrent edits cannot interleave
   * into a state neither side asked for.
   */
  updateSkills(profileId: string, enabled: unknown): { skills: BundledSkill[]; enabled: string[] } {
    const row = loadProfileOrThrow(profileId);

    if (!Array.isArray(enabled) || enabled.some((name) => typeof name !== 'string')) {
      throw new AppError('enabled must be an array of skill names.', {
        code: 'INVALID_SKILL_SELECTION',
        statusCode: 400,
      });
    }

    const known = new Set(listBundledSkills().map((skill) => skill.name));
    const unknown = (enabled as string[]).filter((name) => !known.has(name));
    if (unknown.length > 0) {
      throw new AppError(`Unknown skill(s): ${unknown.join(', ')}.`, {
        code: 'UNKNOWN_SKILL',
        statusCode: 400,
      });
    }

    const profileDir = resolveProfileDir(row.provider, row.slug);
    applySkillSelection(profileDir, enabled as string[]);
    return { skills: listBundledSkills(), enabled: listEnabledSkills(profileDir) };
  },

  /**
   * Links the full bundle into a profile that predates skill bundling.
   *
   * Profiles created before this feature have no `skills/` directory at all, so
   * their sessions see no skills; this is the repair path for them.
   */
  /**
   * Repairs machine-specific paths across every profile.
   *
   * Skill links and plugin install locations are absolute paths, so migrating
   * the data directory between machines breaks them all at once and those
   * profiles' sessions silently lose their skills and plugins. Runs at
   * startup; each profile keeps its own selection — only entries that already
   * exist but point nowhere are refreshed.
   */
  repairAllProfilePaths(): void {
    for (const row of profilesRepository.list()) {
      const profileDir = resolveProfileDir(row.provider, row.slug);
      try {
        repairSkillLinks(profileDir);
        repairPluginConfigPaths(profileDir);
      } catch {
        // One unreadable profile dir should not stop the others from healing.
      }
    }
  },

  restoreAllSkills(profileId: string): { enabled: string[] } {
    const row = loadProfileOrThrow(profileId);
    const profileDir = resolveProfileDir(row.provider, row.slug);
    enableAllSkills(profileDir);
    return { enabled: listEnabledSkills(profileDir) };
  },

  getAuthStatus(profileId: string): ProfileAuthStatus {
    return { authenticated: isProfileAuthenticated(loadProfileOrThrow(profileId)) };
  },
};

function loadProfileOrThrow(id: string): ProfileRow {
  const row = profilesRepository.getById(id);
  if (!row) {
    throw new AppError(`Profile "${id}" was not found.`, {
      code: 'PROFILE_NOT_FOUND',
      statusCode: 404,
    });
  }
  return row;
}
