import { getConnection } from '@/modules/database/connection.js';

export type PreviewConfigRow = {
  project_path: string;
  command: string;
  setup_command: string | null;
  bind_host: string | null;
  port: number | null;
  updated_at: string;
};

export const previewConfigsDb = {
  getByProjectPath(projectPath: string): PreviewConfigRow | null {
    if (!projectPath) {
      return null;
    }

    const row = getConnection()
      .prepare(`
        SELECT project_path, command, setup_command, bind_host, port, updated_at
        FROM preview_configs
        WHERE project_path = ?
      `)
      .get(projectPath) as PreviewConfigRow | undefined;

    return row ?? null;
  },

  upsert(entry: {
    projectPath: string;
    command: string;
    setupCommand?: string | null;
    bindHost?: string | null;
    port?: number | null;
  }): void {
    const command = entry.command.trim();
    if (!entry.projectPath || !command) {
      return;
    }

    getConnection()
      .prepare(`
        INSERT INTO preview_configs (project_path, command, setup_command, bind_host, port, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(project_path) DO UPDATE SET
          command = excluded.command,
          setup_command = excluded.setup_command,
          bind_host = excluded.bind_host,
          port = excluded.port,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        entry.projectPath,
        command,
        entry.setupCommand?.trim() || null,
        entry.bindHost?.trim() || null,
        entry.port ?? null,
      );
  },
};
