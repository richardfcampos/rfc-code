// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution (same choice as routes/git.js).
import spawn from 'cross-spawn';

import type { GitCommandResult } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Default `GitCommandRunner`: spawns `git <args>` in `cwd` and captures output.
 * Rejects with an `AppError` carrying git's stderr when the command fails, so
 * callers (and ultimately the API client) see the real git diagnostic.
 *
 * Lives in shared rather than inside the worktrees module because two
 * independent modules need it: the worktrees HTTP surface and the
 * repository-context resolution that every session write path runs. Importing it
 * from the worktrees barrel would drag the HTTP module into the providers import
 * graph and close a cycle.
 */
export function runGitCommand(args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(
        new AppError(`Failed to run git: ${error.message}`, {
          code: 'GIT_SPAWN_FAILED',
          statusCode: 500,
        }),
      );
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new AppError(`git ${args.join(' ')} failed`, {
          code: 'GIT_COMMAND_FAILED',
          statusCode: 500,
          details: (stderr || stdout).trim(),
        }),
      );
    });
  });
}
