#!/usr/bin/env node
/**
 * `rfc` — a few hundred bytes about a session instead of a 139 KB project
 * dump: send a prompt, read a status, read the result, list sessions, fire a
 * test webhook. Thin client of the Grokbot MCP; every byte of logic lives on
 * the server side in the tools this calls.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseRfcArgs, RfcUsageError, USAGE, type RfcArgs } from './rfc-cli-args.js';
import { createRfcClient, RfcToolError, RfcTransportError } from './rfc-cli-client.js';
import { runNotifyTest, runResult, runSend, runSessions, runStatus, type CallTool, type CommandOutput } from './rfc-cli-commands.js';
import { resolveRfcConfig, RfcConfigError } from './rfc-cli-config.js';
import { stripControlChars } from './rfc-cli-render.js';

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

function readPrompt(args: RfcArgs): string {
  if (args.flags.file === undefined) return args.positionals[1];
  const source = args.flags.file === '-' ? '/dev/stdin' : args.flags.file;
  let content: string;
  try {
    content = fs.readFileSync(source, 'utf8');
  } catch (error) {
    throw new RfcUsageError(`Could not read ${args.flags.file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (content.trim() === '') throw new RfcUsageError('The prompt file is empty.');
  return content;
}

export async function dispatch(args: RfcArgs, callTool: CallTool): Promise<CommandOutput> {
  switch (args.command) {
    case 'send':
      return runSend(callTool, args.positionals[0], readPrompt(args));
    case 'status':
      return runStatus(callTool, args.positionals[0]);
    case 'result':
      return runResult(callTool, args.positionals[0], args.flags.since);
    case 'sessions':
      return runSessions(callTool, args.flags.project);
    case 'notify-test':
      return runNotifyTest(callTool, args.positionals[0]);
    case 'help':
      return { json: { usage: USAGE }, text: USAGE };
  }
}

export async function main(argv: string[]): Promise<number> {
  let args: RfcArgs;
  try {
    args = parseRfcArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    return EXIT_USAGE;
  }
  if (args.command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return EXIT_OK;
  }

  let callTool: CallTool;
  try {
    const config = resolveRfcConfig();
    callTool = createRfcClient(config).callTool;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_USAGE;
  }

  try {
    const output = await dispatch(args, callTool);
    // Agent-authored text reaches a terminal here; control bytes could drive it.
    process.stdout.write(`${args.flags.json ? JSON.stringify(output.json) : stripControlChars(output.text)}\n`);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof RfcUsageError || error instanceof RfcConfigError) {
      process.stderr.write(`${error.message}\n`);
      return EXIT_USAGE;
    }
    if (error instanceof RfcToolError) {
      process.stderr.write(`${error.tool}: ${error.message}\n`);
      return EXIT_FAILED;
    }
    if (error instanceof RfcTransportError) {
      process.stderr.write(`${error.message}\n`);
      return EXIT_FAILED;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILED;
  }
}

// Only run when executed directly, so tests can import `main` and `dispatch`.
// npm installs `bin` entries as symlinks and node keeps the link path in
// argv[1], so both sides are resolved to their real path before comparing.
function isInvokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return /rfc-cli\.(js|ts)$/.test(entry);
  }
}
if (isInvokedDirectly()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
