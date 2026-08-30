import type { Project } from '../../../types/app';
import { getPendingPermissionsForSession } from '../../chat/utils/pending-permission-registry';
import type { SessionWithProvider } from '../types/types';

import { resolveSessionStatus } from './session-status';
import { getAllSessions, getSessionDate, getSessionWorktreeLabel } from './utils';

/**
 * A session plus the project that owns it. Sessions are rendered in one flat
 * list now, so every row still has to know which project to activate when the
 * user opens it (the list can span projects while no project is selected).
 */
export type SidebarSessionEntry = {
  project: Project;
  session: SessionWithProvider;
};

export type SidebarSessionGroupKey = 'running' | 'needsYou' | 'recent';

export type SidebarSessionGroup = {
  key: SidebarSessionGroupKey;
  entries: SidebarSessionEntry[];
};

const byMostRecent = (a: SidebarSessionEntry, b: SidebarSessionEntry): number =>
  getSessionDate(b.session).getTime() - getSessionDate(a.session).getTime();

/**
 * Sessions of the selected project, or — while nothing is selected — of every
 * project, so the list is never empty just because the app booted without a
 * project in the URL.
 */
export const collectSessionEntries = (
  projects: Project[],
  selectedProject: Project | null,
): SidebarSessionEntry[] => {
  const scoped = selectedProject
    ? projects.filter((project) => project.projectId === selectedProject.projectId)
    : projects;
  // A freshly selected project can be missing from `projects` for one render
  // (list refresh in flight); fall back to the selection itself.
  const source = scoped.length > 0 ? scoped : selectedProject ? [selectedProject] : [];

  return source
    .flatMap((project) => getAllSessions(project).map((session) => ({ project, session })))
    .sort(byMostRecent);
};

/** Running sessions across every project, regardless of the selected one. */
export const collectRunningSessionEntries = (
  projects: Project[],
  activeSessionIds: ReadonlySet<string>,
): SidebarSessionEntry[] => {
  if (activeSessionIds.size === 0) {
    return [];
  }

  return projects
    .flatMap((project) => getAllSessions(project).map((session) => ({ project, session })))
    .filter((entry) => activeSessionIds.has(String(entry.session.id)))
    .sort(byMostRecent);
};

/** Case-insensitive match on the session title and its worktree branch. */
export const filterSessionEntries = (
  entries: SidebarSessionEntry[],
  query: string,
): SidebarSessionEntry[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries;
  }

  return entries.filter(({ session }) => {
    const title = String(session.summary || session.name || session.id).toLowerCase();
    if (title.includes(normalized)) {
      return true;
    }

    const branch = getSessionWorktreeLabel(session);
    return Boolean(branch && branch.toLowerCase().includes(normalized));
  });
};

/**
 * A session waits on the user when the app tracked an attention flag for it or
 * when the permission registry still holds an unanswered request — the
 * registry survives remounts and session switches, the flag does not.
 */
export const sessionNeedsUser = (
  sessionId: string,
  attentionSessionIds: ReadonlySet<string>,
): boolean => attentionSessionIds.has(sessionId) || getPendingPermissionsForSession(sessionId).length > 0;

/**
 * Splits sessions into the three sidebar groups. Waiting on the user wins over
 * running, because that session is the one blocking progress.
 */
export const groupSessionEntries = (
  entries: SidebarSessionEntry[],
  activeSessionIds: ReadonlySet<string>,
  attentionSessionIds: ReadonlySet<string>,
): SidebarSessionGroup[] => {
  const running: SidebarSessionEntry[] = [];
  const needsYou: SidebarSessionEntry[] = [];
  const recent: SidebarSessionEntry[] = [];

  for (const entry of entries) {
    const sessionId = String(entry.session.id);
    const status = resolveSessionStatus({
      needsAttention: sessionNeedsUser(sessionId, attentionSessionIds),
      isRunning: activeSessionIds.has(sessionId),
    });

    if (status === 'attn') {
      needsYou.push(entry);
    } else if (status === 'run') {
      running.push(entry);
    } else {
      recent.push(entry);
    }
  }

  return ([
    { key: 'running', entries: running },
    { key: 'needsYou', entries: needsYou },
    { key: 'recent', entries: recent },
  ] as SidebarSessionGroup[]).filter((group) => group.entries.length > 0);
};
