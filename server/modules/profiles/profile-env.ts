/**
 * Pure, DB-free mapping from an account profile to the environment that
 * redirects a provider CLI at an isolated per-profile config directory.
 *
 * This is the heart of multi-account isolation: every provider exposes a
 * different native knob for relocating its credential store, and this module is
 * the single place that knows which knob to turn. The session-dispatch
 * injection points (Claude SDK options, Codex client, Cursor/OpenCode spawns)
 * all funnel through here so isolation stays consistent across providers.
 */

import path from 'node:path';

import type { LLMProvider } from '@/shared/types.js';

/**
 * Root directory under which every profile gets `<provider>/<slug>`.
 *
 * Defaults to the container's `/data/profiles` volume mount; overridable via
 * `PROFILES_ROOT` (used by tests to keep directories inside a temp dir).
 */
export function getProfilesRoot(): string {
  return process.env.PROFILES_ROOT || '/data/profiles';
}

/** Absolute path to one profile's isolated config directory. */
export function resolveProfileDir(provider: LLMProvider, slug: string): string {
  return path.join(getProfilesRoot(), provider, slug);
}

/**
 * Environment variables that point a provider CLI at `profileDir`.
 *
 * Per-provider native knobs:
 *  - claude:   `CLAUDE_CONFIG_DIR` (first-class support)
 *  - codex:    `CODEX_HOME`
 *  - cursor:   `HOME` (no dedicated var; cursor-agent stores auth under HOME)
 *  - opencode: `XDG_CONFIG_HOME` + `XDG_DATA_HOME` (XDG base directories)
 */
export function resolveProviderEnv(
  provider: LLMProvider,
  profileDir: string,
): Record<string, string> {
  switch (provider) {
    case 'claude':
      return { CLAUDE_CONFIG_DIR: profileDir };
    case 'codex':
      return { CODEX_HOME: profileDir };
    case 'cursor':
      return { HOME: profileDir };
    case 'opencode':
      return {
        XDG_CONFIG_HOME: path.join(profileDir, 'config'),
        XDG_DATA_HOME: path.join(profileDir, 'data'),
      };
    default: {
      // Exhaustiveness guard: adding a provider must declare its isolation env.
      const unsupported: never = provider;
      throw new Error(`No isolation env defined for provider "${String(unsupported)}"`);
    }
  }
}

/**
 * Best-effort path whose presence marks a profile as authenticated.
 *
 * The exact credential filenames are the providers' own login artifacts
 * (`auth.json` for codex/cursor/opencode; `.credentials.json` for claude) and
 * are treated as best-effort here — the authoritative check remains the CLI at
 * run time. These paths get validated during the interactive login UAT.
 */
export function resolveCredentialPath(provider: LLMProvider, profileDir: string): string {
  switch (provider) {
    case 'claude':
      return path.join(profileDir, '.credentials.json');
    case 'codex':
      return path.join(profileDir, 'auth.json');
    case 'cursor':
      return path.join(profileDir, '.cursor', 'auth.json');
    case 'opencode':
      return path.join(profileDir, 'data', 'opencode', 'auth.json');
    default: {
      const unsupported: never = provider;
      throw new Error(`No credential path defined for provider "${String(unsupported)}"`);
    }
  }
}
