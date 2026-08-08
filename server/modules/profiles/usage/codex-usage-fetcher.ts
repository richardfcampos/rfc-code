/**
 * Plan-usage fetcher for Codex profiles.
 *
 * Codex has no queryable usage API, but every session rollout JSONL under
 * `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl` records `token_count`
 * events carrying a `rate_limits` payload (primary = rolling 5h window,
 * secondary = plan week/month window, both as `used_percent`). The freshest
 * event in the newest rollout is the best available answer — stale by design,
 * so the snapshot carries `asOf` for the UI to caveat.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  clampUtilization,
  type ProfileUsageSnapshot,
  type ProfileUsageWindow,
} from './profile-usage.types.js';

const TAIL_BYTES = 256 * 1024;

interface RateLimitWindow {
  used_percent?: unknown;
  window_minutes?: unknown;
  resets_in_seconds?: unknown;
}

/** Newest rollout file, exploiting the date-named directory layout. */
function findLatestRollout(sessionsDir: string): string | null {
  const descend = (dir: string, depth: number): string | null => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    if (depth === 0) {
      const files = entries
        .filter((e) => e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl'))
        .map((e) => path.join(dir, e.name));
      if (files.length === 0) {
        return null;
      }
      // Rollout names embed a sortable timestamp; newest last.
      return files.sort()[files.length - 1] ?? null;
    }
    const subdirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const name of subdirs) {
      const found = descend(path.join(dir, name), depth - 1);
      if (found) {
        return found;
      }
    }
    return null;
  };
  // sessions/YYYY/MM/DD/rollout-*.jsonl → three directory levels.
  return descend(sessionsDir, 3);
}

function readTail(filePath: string): string {
  const { size } = fs.statSync(filePath);
  const start = Math.max(0, size - TAIL_BYTES);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  return buffer.toString('utf8');
}

function toWindow(id: 'primary' | 'secondary', raw: RateLimitWindow, eventTime: Date | null): ProfileUsageWindow | null {
  if (typeof raw.used_percent !== 'number' || !Number.isFinite(raw.used_percent)) {
    return null;
  }
  const minutes = typeof raw.window_minutes === 'number' ? raw.window_minutes : null;
  const label = minutes !== null ? (minutes >= 1440 ? `${Math.round(minutes / 1440)}d` : `${Math.round(minutes / 60)}h`) : id;
  let resetsAt: string | null = null;
  if (eventTime && typeof raw.resets_in_seconds === 'number' && Number.isFinite(raw.resets_in_seconds)) {
    resetsAt = new Date(eventTime.getTime() + raw.resets_in_seconds * 1000).toISOString();
  }
  return { id, label, utilization: clampUtilization(raw.used_percent), resetsAt };
}

function extractLatestRateLimits(tail: string): { windows: ProfileUsageWindow[]; asOf: string | null } | null {
  const lines = tail.split('\n');
  // First line of a tail read is usually truncated; scanning backwards makes
  // that harmless — the freshest complete event wins anyway.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('rate_limits')) {
      continue;
    }
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const payload = (event.payload ?? event) as Record<string, unknown>;
      const rateLimits = (payload.rate_limits ?? event.rate_limits) as
        | { primary?: RateLimitWindow; secondary?: RateLimitWindow }
        | undefined;
      if (!rateLimits || typeof rateLimits !== 'object') {
        continue;
      }
      const timestamp = typeof event.timestamp === 'string' ? event.timestamp : null;
      const eventTime = timestamp ? new Date(timestamp) : null;
      const windows: ProfileUsageWindow[] = [];
      if (rateLimits.primary) {
        const window = toWindow('primary', rateLimits.primary, eventTime);
        if (window) {
          windows.push(window);
        }
      }
      if (rateLimits.secondary) {
        const window = toWindow('secondary', rateLimits.secondary, eventTime);
        if (window) {
          windows.push(window);
        }
      }
      if (windows.length > 0) {
        return { windows, asOf: timestamp };
      }
    } catch {
      // Truncated or non-JSON line — keep scanning backwards.
    }
  }
  return null;
}

export async function fetchCodexUsage(
  profileDir: string,
  options: { now?: () => Date } = {},
): Promise<ProfileUsageSnapshot> {
  const now = options.now ?? (() => new Date());
  const base: Omit<ProfileUsageSnapshot, 'status'> = {
    supported: true,
    windows: [],
    plan: null,
    asOf: null,
    fetchedAt: now().toISOString(),
  };

  try {
    const rollout = findLatestRollout(path.join(profileDir, 'sessions'));
    if (!rollout) {
      return { ...base, status: 'unavailable' };
    }
    const extracted = extractLatestRateLimits(readTail(rollout));
    if (!extracted) {
      return { ...base, status: 'unavailable' };
    }
    return { ...base, status: 'ok', windows: extracted.windows, asOf: extracted.asOf };
  } catch {
    return { ...base, status: 'unavailable' };
  }
}
