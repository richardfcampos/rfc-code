/**
 * Where the CLI learns the server URL and the API key: environment first, then
 * `~/.rfc-code/rfc-cli.json`. The key is only ever placed in a request header;
 * nothing here prints or logs it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type RfcCliConfig = { url: string; apiKey: string };

export const DEFAULT_RFC_URL = 'http://localhost:7799';

export class RfcConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RfcConfigError';
  }
}

/** The subset of the environment the CLI reads; `process.env` satisfies it. */
export type ConfigEnv = Record<string, string | undefined>;

export function defaultConfigPath(env: ConfigEnv = process.env): string {
  if (env.RFC_CLI_CONFIG && env.RFC_CLI_CONFIG.trim()) return env.RFC_CLI_CONFIG.trim();
  const home = env.HOME && env.HOME.trim() ? env.HOME.trim() : os.homedir();
  return path.join(home, '.rfc-code', 'rfc-cli.json');
}

function warnIfWorldReadable(filePath: string): void {
  try {
    const mode = fs.statSync(filePath).mode & 0o777;
    if (mode & 0o077) {
      process.stderr.write(`warning: ${filePath} is readable by other users (mode ${mode.toString(8)}); run chmod 600 on it.\n`);
    }
  } catch {
    // Not stat-able: the read below reports it.
  }
}

function readConfigFile(filePath: string): Partial<RfcCliConfig> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  warnIfWorldReadable(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RfcConfigError(`${filePath} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RfcConfigError(`${filePath} must contain a JSON object with "url" and "apiKey".`);
  }
  const record = parsed as Record<string, unknown>;
  return {
    ...(typeof record.url === 'string' ? { url: record.url } : {}),
    ...(typeof record.apiKey === 'string' ? { apiKey: record.apiKey } : {}),
  };
}

function normaliseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(trimmed)) {
    throw new RfcConfigError(`RFC_URL must start with http:// or https:// (got "${trimmed}").`);
  }
  return trimmed;
}

export function missingKeyMessage(filePath: string): string {
  return [
    'No API key configured.',
    'Create one in RFC Code: Settings > API Tokens, then either export RFC_API_KEY',
    `or write ${filePath} (chmod 600) with:`,
    `  {"url": "${DEFAULT_RFC_URL}", "apiKey": "ck_..."}`,
  ].join('\n');
}

export function resolveRfcConfig(env: ConfigEnv = process.env): RfcCliConfig {
  const filePath = defaultConfigPath(env);
  const fromFile = readConfigFile(filePath);
  const apiKey = (env.RFC_API_KEY && env.RFC_API_KEY.trim()) || (fromFile.apiKey && fromFile.apiKey.trim()) || '';
  if (!apiKey) throw new RfcConfigError(missingKeyMessage(filePath));
  const url = (env.RFC_URL && env.RFC_URL.trim()) || (fromFile.url && fromFile.url.trim()) || DEFAULT_RFC_URL;
  return { url: normaliseUrl(url), apiKey };
}
