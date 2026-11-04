/**
 * Pure argv parser of the `rfc` CLI. No I/O: the entrypoint turns the result
 * into calls, so every parsing rule is unit-testable in isolation.
 */

export const RFC_COMMANDS = ['send', 'status', 'result', 'sessions', 'notify-test', 'help'] as const;
export type RfcCommand = (typeof RFC_COMMANDS)[number];

export type RfcFlags = {
  json: boolean;
  file?: string;
  since?: number;
  project?: string;
};

export type RfcArgs = {
  command: RfcCommand;
  positionals: string[];
  flags: RfcFlags;
};

export class RfcUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RfcUsageError';
  }
}

export const USAGE = `rfc — compact CLI over the RFC Code Grokbot MCP

Usage:
  rfc send <sessionId> "<prompt>"       send a prompt, print "sent <id> seq=<n>"
  rfc send <sessionId> --file <path>    prompt from a file ("-" reads stdin)
  rfc status <sessionId>                state, timings, last seq, pending approval
  rfc result <sessionId> [--since <seq>]
                                        last turn: response, changed files, tests, commit
  rfc sessions [--project <name>]       one line per session
  rfc notify-test <endpointId>          fire a test webhook delivery

Flags:
  --json        structured single-line output
  -h, --help    this help

Config: RFC_URL / RFC_API_KEY, or ~/.rfc-code/rfc-cli.json ({"url","apiKey"}).
Exit codes: 0 ok, 1 tool/transport error, 2 usage or config error.`;

const VALUE_FLAGS = new Set(['--file', '--since', '--project']);

function isCommand(value: string): value is RfcCommand {
  return (RFC_COMMANDS as readonly string[]).includes(value);
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new RfcUsageError(`${flag} needs a value.`);
  }
  return value;
}

export function parseRfcArgs(argv: string[]): RfcArgs {
  const positionals: string[] = [];
  const flags: RfcFlags = { json: false };
  let command: RfcCommand | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-h' || token === '--help') {
      return { command: 'help', positionals: [], flags };
    }
    if (token === '--json') {
      flags.json = true;
      continue;
    }
    if (VALUE_FLAGS.has(token)) {
      const value = takeValue(argv, index, token);
      index += 1;
      if (token === '--file') flags.file = value;
      else if (token === '--project') flags.project = value;
      else {
        const since = Number.parseInt(value, 10);
        if (!Number.isInteger(since) || since < 0 || String(since) !== value.trim()) {
          throw new RfcUsageError('--since must be a non-negative integer.');
        }
        flags.since = since;
      }
      continue;
    }
    if (token.startsWith('-') && token !== '-') {
      throw new RfcUsageError(`Unknown flag ${token}.`);
    }
    if (command === null) {
      if (!isCommand(token)) throw new RfcUsageError(`Unknown command "${token}".`);
      command = token;
      continue;
    }
    positionals.push(token);
  }

  if (command === null) throw new RfcUsageError('A command is required.');
  validateArity(command, positionals, flags);
  return { command, positionals, flags };
}

function validateArity(command: RfcCommand, positionals: string[], flags: RfcFlags): void {
  switch (command) {
    case 'send':
      if (positionals.length < 1) throw new RfcUsageError('send needs a sessionId.');
      if (flags.file === undefined && positionals.length !== 2) {
        throw new RfcUsageError('send needs a prompt argument or --file <path>.');
      }
      if (flags.file !== undefined && positionals.length !== 1) {
        throw new RfcUsageError('send takes either a prompt argument or --file, not both.');
      }
      return;
    case 'status':
    case 'result':
      if (positionals.length !== 1) throw new RfcUsageError(`${command} needs exactly one sessionId.`);
      return;
    case 'notify-test':
      if (positionals.length !== 1) throw new RfcUsageError('notify-test needs exactly one endpointId.');
      return;
    case 'sessions':
      if (positionals.length !== 0) throw new RfcUsageError('sessions takes no positional arguments.');
      return;
    case 'help':
      return;
  }
}
