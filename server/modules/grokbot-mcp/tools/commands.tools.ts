/**
 * Slash-command tools (REST) and the one-shot shell runner (in-process).
 */
import type { ToolDefinition } from '../grokbot-mcp.types.js';

import { optObject, optInt, optStr, pick, S, schema, str, strArray, tool, ToolInputError } from './tool-helpers.js';

export const commandTools: ToolDefinition[] = [
  tool({
    name: 'command_list',
    description:
      'List the slash commands available to the agent: built-in ones plus custom commands found in the project ' +
      '.claude/commands directory (when projectPath is given) and the user commands directory.',
    inputSchema: schema({ projectPath: S.string('Absolute project path whose .claude/commands should be scanned.') }),
    covers: ['POST /api/commands/list'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: '/api/commands/list', body: pick(args, ['projectPath']) }),
  }),
  tool({
    name: 'command_execute',
    description:
      'Prepare or run a slash command by name (for example "help", "models" or a custom command from command_list). ' +
      'Built-in commands return their result; custom commands return their expanded prompt content.',
    inputSchema: schema(
      {
        commandName: S.string('Command name as listed by command_list, e.g. "/help".'),
        commandPath: S.string('Path of the custom command file, as returned by command_list.'),
        args: S.stringArray('Positional arguments passed to the command.'),
        context: S.object('Execution context: provider, sessionId, projectPath, tokenUsage, model.'),
      },
      ['commandName'],
    ),
    covers: ['POST /api/commands/execute'],
    run: (args, ctx) => {
      const body: Record<string, unknown> = { commandName: str(args, 'commandName') };
      const commandPath = optStr(args, 'commandPath');
      if (commandPath !== undefined) {
        body.commandPath = commandPath;
      }
      if (args.args !== undefined && args.args !== null) {
        body.args = strArray(args, 'args');
      }
      const context = optObject(args, 'context');
      if (context !== undefined) {
        body.context = context;
      }
      return ctx.api.dispatch({ method: 'POST', path: '/api/commands/execute', body });
    },
  }),
  tool({
    name: 'shell_exec',
    description:
      'Run one shell command and return exitCode, stdout and stderr. One-shot: no PTY and no interactive input, so ' +
      'do not start editors, REPLs or long-running servers. Runs in the project directory (projectId) or in any ' +
      'directory such as a worktree path (cwd; wins over projectId). Has a timeout (timeoutMs) and an output cap ' +
      'after which output is truncated. Give projectId or cwd.',
    inputSchema: schema({
      projectId: S.string('Project registry id, as returned by project_list; the command runs in its directory.'),
      cwd: S.string('Absolute directory to run in, e.g. a worktree path. Takes precedence over projectId.'),
      command: S.string('Shell command line to run.'),
      timeoutMs: S.integer('Kill the command after this many milliseconds.'),
    }, ['command']),
    covers: [],
    run: async (args, ctx) => {
      const command = str(args, 'command');
      const explicitCwd = optStr(args, 'cwd')?.trim();
      const projectId = optStr(args, 'projectId')?.trim();
      let cwd = explicitCwd;
      if (!cwd) {
        if (!projectId) {
          throw new ToolInputError('projectId or cwd is required.');
        }
        cwd = (await ctx.resolveProjectPath(projectId)) ?? undefined;
        if (!cwd) {
          throw new ToolInputError('projectId is unknown');
        }
      }
      const timeoutMs = optInt(args, 'timeoutMs');
      return ctx.shell.exec(timeoutMs === undefined ? { cwd, command } : { cwd, command, timeoutMs });
    },
  }),
];
