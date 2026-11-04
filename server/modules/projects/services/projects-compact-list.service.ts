/**
 * The compact project list: one short row per project for external agents
 * that only need to pick a project and see whether something is running.
 *
 * The full list ships every project's recent sessions (tens of kilobytes
 * across worktree projects); this one carries counts and the last activity
 * instead, and drops worktree registrations that never had a session.
 */

import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionSynchronizerService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

export type CompactProjectListItem = {
  projectId: string;
  name: string;
  path: string;
  activeSessions: number;
  sessionsTotal: number;
  /** ISO timestamp of the most recently touched session; null when the project has none. */
  lastActivity: string | null;
};

type GetProjectsCompactOptions = {
  skipSynchronization?: boolean;
};

/** Worktree registrations live under `<repo>-worktrees/`; empty ones are noise. */
const WORKTREES_SEGMENT = /-worktrees\//;

function isEmptyWorktreeProject(projectPath: string, sessionsTotal: number): boolean {
  return sessionsTotal === 0 && WORKTREES_SEGMENT.test(`${projectPath}/`);
}

/** Running runs grouped by project path, resolved once for the whole list. */
function countRunningByProjectPath(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of chatRunRegistry.listRunningRuns()) {
    const projectPath = sessionsDb.getSessionById(run.sessionId)?.project_path;
    if (!projectPath) continue;
    counts.set(projectPath, (counts.get(projectPath) ?? 0) + 1);
  }
  return counts;
}

function latestActivity(projectPath: string): string | null {
  let latest: string | null = null;
  for (const session of sessionsDb.getSessionsByProjectPath(projectPath)) {
    const candidate = session.updated_at ?? session.created_at ?? null;
    // Rows mix ISO and SQLite timestamp formats; compare instants, not strings.
    if (candidate && (!latest || Date.parse(candidate) > Date.parse(latest))) latest = candidate;
  }
  return latest;
}

export async function getProjectsCompact(options: GetProjectsCompactOptions = {}): Promise<CompactProjectListItem[]> {
  if (!options.skipSynchronization) {
    await sessionSynchronizerService.synchronizeSessions();
  }

  const running = countRunningByProjectPath();
  const items: CompactProjectListItem[] = [];

  for (const row of projectsDb.getProjectPaths()) {
    const sessionsTotal = sessionsDb.countSessionsByProjectPath(row.project_path);
    if (isEmptyWorktreeProject(row.project_path, sessionsTotal)) continue;

    const custom = row.custom_project_name?.trim();
    items.push({
      projectId: row.project_id,
      name: custom || path.basename(row.project_path) || row.project_path,
      path: row.project_path,
      activeSessions: running.get(row.project_path) ?? 0,
      sessionsTotal,
      lastActivity: latestActivity(row.project_path),
    });
  }

  return items;
}
