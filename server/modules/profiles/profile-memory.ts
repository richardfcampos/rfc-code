/**
 * Where the shared project memory lives.
 *
 * Claude Code's auto-memory (`<config dir>/projects/<slug>/memory/`) is the
 * store every provider reads and writes: it is plain markdown, already
 * populated by Claude sessions, and keyed by working directory. Other
 * providers reach the same directory through `RFC_MEMORY_DIR`, resolved from
 * the default Claude profile so one repository has one memory.
 */

import os from 'node:os';
import path from 'node:path';

import { resolveProfileDir } from '@/modules/profiles/profile-env.js';
import { profilesService } from '@/modules/profiles/profiles.service.js';

/** Env var that hands the shared memory directory to non-Claude providers. */
export const SHARED_MEMORY_ENV = 'RFC_MEMORY_DIR';

/**
 * Claude Code keys its per-project state (transcripts, auto-memory) by the
 * working directory with every non-alphanumeric character replaced by `-`:
 * `/srv/code/app` → `-srv-code-app`, `/x/.claude/y` → `-x--claude-y`.
 */
export function claudeProjectSlug(absolutePath: string): string {
  return absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
}

/** `<configDir>/projects/<slug>/memory` — where Claude Code reads and writes auto-memory. */
export function resolveClaudeMemoryDir(configDir: string, workingDirectory: string): string {
  return path.join(configDir, 'projects', claudeProjectSlug(workingDirectory), 'memory');
}

/** Config dir of the default Claude profile, or Claude Code's own default. */
function resolveDefaultClaudeConfigDir(): string {
  const defaultId = profilesService.resolveDefaultProfileId('claude');
  if (defaultId) {
    const profile = profilesService.getProfile(defaultId);
    return resolveProfileDir('claude', profile.slug);
  }
  return path.join(os.homedir(), '.claude');
}

/** Memory directory a non-Claude session in `workingDirectory` should share. */
export function resolveSharedMemoryDir(workingDirectory: string): string {
  return resolveClaudeMemoryDir(resolveDefaultClaudeConfigDir(), path.resolve(workingDirectory));
}
