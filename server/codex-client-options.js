/**
 * Builds the per-profile options for a `new Codex(...)` client.
 *
 * Kept in its own module (separate from openai-codex.js) so it can be unit
 * tested without importing `@openai/codex-sdk`, whose transitive dependency
 * keeps a background handle open and would prevent the test runner from exiting.
 *
 * Spike verdict (verified against @openai/codex-sdk 0.144.1 source): the SDK
 * accepts an `env` option that each Codex instance stores on its own CodexExec
 * and passes to a fresh `child_process.spawn` per run — no shared/static state
 * across instances. Because `queryCodex` constructs a fresh `new Codex()` per
 * call, two concurrent profiles get fully isolated CODEX_HOME values, so no
 * direct CLI-spawn fallback is needed.
 *
 * Critical: the SDK does NOT inherit `process.env` when `env` is provided, so
 * the full host environment must be merged in alongside the CODEX_HOME override.
 * With no profile this returns `undefined`, so `new Codex()` keeps inheriting
 * `process.env` exactly as upstream did.
 */

import { profilesService } from './modules/profiles/index.js';

export function buildCodexClientOptions(profileId) {
  const profileEnv = profilesService.resolveEnv(profileId);
  if (Object.keys(profileEnv).length === 0) {
    return undefined;
  }
  return { env: { ...process.env, ...profileEnv } };
}
