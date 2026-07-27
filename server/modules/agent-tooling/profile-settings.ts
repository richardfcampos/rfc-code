/**
 * Shared read/write access to a profile's Claude Code `settings.json`.
 *
 * Both agent tooling switches persist into this one file — RTK as a hook entry,
 * caveman as an enabled plugin — so they must go through a single reader and
 * writer. Two modules each doing their own read-modify-write would let the
 * second overwrite the first's change whenever both were applied in one
 * request.
 *
 * A file that does not parse is an error, never something to overwrite: it may
 * hold a login or hooks the user cannot easily recreate.
 */

import fs from 'node:fs';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';

export type HookEntry = { type?: string; command?: string; [key: string]: unknown };
export type HookMatcher = { matcher?: string; hooks?: HookEntry[]; [key: string]: unknown };

export type SettingsShape = {
  hooks?: Record<string, HookMatcher[]>;
  enabledPlugins?: Record<string, boolean>;
  extraKnownMarketplaces?: Record<string, unknown>;
  [key: string]: unknown;
};

export function resolveSettingsPath(profileDir: string): string {
  return path.join(profileDir, 'settings.json');
}

/** Missing file means "no settings yet"; malformed means stop. */
export function readSettings(settingsPath: string): SettingsShape {
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }

  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings.json is not a JSON object');
    }
    return parsed as SettingsShape;
  } catch (error) {
    throw new AppError(
      `Profile settings at ${settingsPath} are not valid JSON, refusing to overwrite them.`,
      {
        code: 'PROFILE_SETTINGS_MALFORMED',
        statusCode: 409,
        details: { reason: (error as Error).message },
      },
    );
  }
}

/** Atomic write so a crash mid-toggle cannot truncate a profile's settings. */
export function writeSettings(settingsPath: string, settings: SettingsShape): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tempPath = `${settingsPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, settingsPath);
}

/** Read, transform, write back — the only supported mutation path. */
export function updateSettings(
  profileDir: string,
  transform: (settings: SettingsShape) => SettingsShape,
): void {
  const settingsPath = resolveSettingsPath(profileDir);
  writeSettings(settingsPath, transform(readSettings(settingsPath)));
}
