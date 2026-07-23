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
import {
  resolveCredentialPath,
  resolveProfileDir,
  resolveProviderEnv,
} from '@/modules/profiles/profile-env.js';
import {
  profilesRepository,
  type ProfileRow,
} from '@/modules/profiles/profiles.repository.js';

const SUPPORTED_PROVIDERS: readonly LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];

export interface ProfileView {
  id: string;
  provider: LLMProvider;
  name: string;
  slug: string;
  createdAt: string;
}

export interface ProfileAuthStatus {
  authenticated: boolean;
}

export interface CreateProfileInput {
  provider: unknown;
  name: unknown;
}

function toView(row: ProfileRow): ProfileView {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
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
    fs.mkdirSync(resolveProfileDir(provider, slug), { recursive: true });

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

    const activeSessions = profilesRepository.countActiveSessions(id);
    if (activeSessions > 0) {
      throw new AppError(
        `Profile "${id}" still has ${activeSessions} active session(s).`,
        { code: 'PROFILE_HAS_ACTIVE_SESSIONS', statusCode: 409 },
      );
    }

    // The row is removed but the on-disk credential directory is intentionally
    // left in place, so re-creating the same account reuses its existing login.
    profilesRepository.deleteById(id);
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

  getAuthStatus(profileId: string): ProfileAuthStatus {
    const row = loadProfileOrThrow(profileId);
    const credentialPath = resolveCredentialPath(
      row.provider,
      resolveProfileDir(row.provider, row.slug),
    );
    return { authenticated: fs.existsSync(credentialPath) };
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
