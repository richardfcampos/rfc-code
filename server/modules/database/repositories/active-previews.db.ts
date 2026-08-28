import { getConnection } from '@/modules/database/connection.js';

export type ActivePreviewRow = {
  cwd: string;
  project_path: string;
  pid: number;
  port: number;
  command: string;
  started_at: string;
};

export const activePreviewsDb = {
  record(entry: { cwd: string; projectPath: string; pid: number; port: number; command: string }): void {
    if (!entry.cwd || !entry.pid) {
      return;
    }

    getConnection()
      .prepare(`
        INSERT INTO active_previews (cwd, project_path, pid, port, command, started_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(cwd) DO UPDATE SET
          project_path = excluded.project_path,
          pid = excluded.pid,
          port = excluded.port,
          command = excluded.command,
          started_at = CURRENT_TIMESTAMP
      `)
      .run(entry.cwd, entry.projectPath, entry.pid, entry.port, entry.command);
  },

  listAll(): ActivePreviewRow[] {
    return getConnection()
      .prepare('SELECT cwd, project_path, pid, port, command, started_at FROM active_previews')
      .all() as ActivePreviewRow[];
  },

  deleteByCwd(cwd: string): void {
    if (!cwd) {
      return;
    }

    getConnection().prepare('DELETE FROM active_previews WHERE cwd = ?').run(cwd);
  },
};
