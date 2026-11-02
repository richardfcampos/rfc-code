/**
 * Argument readers and schema fragments shared by every tools file.
 *
 * Readers throw `ToolInputError` on a bad argument so the JSON-RPC layer can
 * answer `-32602 Invalid params` instead of forwarding junk to the server;
 * what the server would refuse anyway (lengths, enums it owns) is left to it.
 */

import type { JsonObject, JsonSchema, ToolDefinition } from '../grokbot-mcp.types.js';

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

export function str(args: JsonObject, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(`${name} is required.`);
  }
  return value.trim();
}

export function optStr(args: JsonObject, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolInputError(`${name} must be a string.`);
  }
  return value;
}

export function optBool(args: JsonObject, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ToolInputError(`${name} must be a boolean.`);
  }
  return value;
}

export function optInt(args: JsonObject, name: string): number | undefined {
  const value = args[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ToolInputError(`${name} must be an integer.`);
  }
  return value;
}

export function strArray(args: JsonObject, name: string): string[] {
  const value = args[name];
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string')) {
    throw new ToolInputError(`${name} must be a non-empty array of strings.`);
  }
  return value as string[];
}

export function optObject(args: JsonObject, name: string): JsonObject | undefined {
  const value = args[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolInputError(`${name} must be an object.`);
  }
  return value as JsonObject;
}

/** Keeps only the listed keys that are present, so partial updates stay partial. */
export function pick(args: JsonObject, keys: string[]): JsonObject {
  const out: JsonObject = {};
  for (const key of keys) {
    if (args[key] !== undefined) {
      out[key] = args[key];
    }
  }
  return out;
}

// ---- schema fragments ----

export const S = {
  string: (description: string): JsonObject => ({ type: 'string', description }),
  boolean: (description: string): JsonObject => ({ type: 'boolean', description }),
  integer: (description: string): JsonObject => ({ type: 'integer', description }),
  number: (description: string): JsonObject => ({ type: 'number', description }),
  object: (description: string): JsonObject => ({ type: 'object', description, additionalProperties: true }),
  enumOf: (values: readonly string[], description: string): JsonObject => ({ type: 'string', enum: [...values], description }),
  stringArray: (description: string): JsonObject => ({ type: 'array', items: { type: 'string' }, description }),
  array: (items: JsonObject, description: string): JsonObject => ({ type: 'array', items, description }),
};

export function schema(properties: Record<string, JsonObject>, required: string[] = []): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

export const PROVIDERS = ['claude', 'codex', 'cursor', 'opencode'] as const;
export const MCP_SCOPES = ['user', 'local', 'project'] as const;
export const TASK_STAGES = ['backlog', 'in_progress', 'review', 'done'] as const;
export const PROJECT_ID = S.string('Project registry id, as returned by project_list.');

/** Loopback timeout for routes that wait on a subprocess (git network ops, installs, AI calls). */
export const LONG_RUNNING_TIMEOUT_MS = 10 * 60 * 1000;

/** Narrow constructor so tool files stay declarative and typo-free. */
export function tool(definition: ToolDefinition): ToolDefinition {
  return definition;
}

/**
 * Encodes a path segment that came from the client. A dot segment survives
 * encoding and would make the request land on a different route than the
 * tool names, so it is refused outright.
 */
export function seg(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '.' || trimmed === '..') {
    throw new ToolInputError(`"${value}" is not a valid identifier.`);
  }
  return encodeURIComponent(trimmed);
}
