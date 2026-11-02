/**
 * One-shot shell command for the Grokbot MCP.
 *
 * The UI's Shell tab is an interactive PTY over its own socket with no
 * in-process entry point; a bot needs "run this, give me the output" instead.
 * Every run is bounded — a deadline that SIGKILLs the process and a per-stream
 * output cap — so one call can neither hang the request nor flood memory.
 * A non-zero exit is a result, not an error: the caller reads `exitCode`.
 */

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

import { gatewayError } from './chat-gateway-profile.js';
import type { ShellExecInput, ShellExecResult, ShellRunner } from './grokbot-mcp.types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const EXIT_GRACE_MS = 1000;

function clampPositive(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

async function isDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

/** Accumulates one stream up to `limit` bytes and remembers whether anything was cut. */
function createCappedBuffer(limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  return {
    push(chunk: Buffer): void {
      const room = limit - size;
      if (room <= 0) {
        truncated = true;
        return;
      }
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (kept.length < chunk.length) truncated = true;
      chunks.push(kept);
      size += kept.length;
    },
    text: (): string => Buffer.concat(chunks).toString('utf8'),
    get truncated(): boolean {
      return truncated;
    },
  };
}

function shellInvocation(command: string): { file: string; args: string[] } {
  return process.platform === 'win32'
    ? { file: 'powershell', args: ['-NoProfile', '-Command', command] }
    : { file: 'bash', args: ['-lc', command] };
}

export function createShellRunner(): ShellRunner {
  return {
    async exec(input: ShellExecInput): Promise<ShellExecResult> {
      if (!input.cwd || !(await isDirectory(input.cwd))) {
        throw gatewayError(400, 'CWD_NOT_FOUND', `Working directory "${input.cwd}" does not exist or is not a directory.`);
      }

      const timeoutMs = clampPositive(input.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const maxOutputBytes = clampPositive(input.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES);
      const { file, args } = shellInvocation(input.command);

      return new Promise<ShellExecResult>((resolve, reject) => {
        const stdout = createCappedBuffer(maxOutputBytes);
        const stderr = createCappedBuffer(maxOutputBytes);
        let timedOut = false;

        const child = spawn(file, args, {
          cwd: input.cwd,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          // Own process group so the deadline can kill the whole tree, not
          // just the shell (a `bash -lc 'sleep 5'` child would otherwise
          // keep the pipes open past the kill).
          detached: process.platform !== 'win32',
        });

        const kill = (): void => {
          try {
            if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        };

        let settled = false;
        let graceTimer: NodeJS.Timeout | undefined;
        const finish = (exitCode: number | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          clearTimeout(graceTimer);
          resolve({
            exitCode,
            stdout: stdout.text(),
            stderr: stderr.text(),
            timedOut,
            truncated: stdout.truncated || stderr.truncated,
          });
        };
        // A grandchild that left the process group (`setsid cmd &`) survives the
        // group kill and keeps our pipes open, so 'close' may never come; the
        // pipes are cut and whatever was read so far is returned instead.
        const abandonPipes = (exitCode: number | null): void => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(exitCode);
        };

        const deadline = setTimeout(() => {
          timedOut = true;
          kill();
          abandonPipes(child.exitCode);
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

        child.on('error', (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          clearTimeout(graceTimer);
          reject(gatewayError(500, 'SHELL_SPAWN_FAILED', `Could not start the shell: ${error.message}`));
        });

        // The shell is gone; give its pipes a moment to drain before giving up on them.
        child.on('exit', (code) => {
          if (!settled) graceTimer = setTimeout(() => abandonPipes(code), EXIT_GRACE_MS);
        });

        child.on('close', (code) => finish(code));
      });
    },
  };
}
