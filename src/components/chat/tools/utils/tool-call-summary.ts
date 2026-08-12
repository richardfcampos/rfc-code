import type { ChatMessage } from '../../types/types';
import { getToolConfig } from '../configs/toolConfigs';

export interface ToolCallSummary {
  /** Mono bold tool name, e.g. `Read`. */
  label: string;
  /** The call's primary argument: a path, a pattern or a command. */
  primary: string;
  /** Optional muted tail such as `11 matches in 6 files`. */
  detail?: string;
}

const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'ApplyPatch', 'NotebookEdit']);

export function parseToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== 'string') {
    return toolInput;
  }

  try {
    return JSON.parse(toolInput);
  } catch {
    return toolInput;
  }
}

function readString(source: unknown, key: string): string {
  if (!source || typeof source !== 'object') return '';
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function readCount(source: unknown, keys: string[]): number | null {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/** Paths read better relative to the project the thread belongs to. */
function relativizePath(path: string, projectPath?: string | null): string {
  if (!path || !projectPath) return path;
  const prefix = projectPath.endsWith('/') ? projectPath : `${projectPath}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function fileLabel(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

function matchLabel(count: number): string {
  return `${count} ${count === 1 ? 'match' : 'matches'}`;
}

/** Search tools carry their own tallies, so the row can state what was found. */
function searchDetail(message: ChatMessage): string | undefined {
  const structured = message.toolResult?.toolUseResult;
  const files = readCount(structured, ['numFiles']);
  const matches = readCount(structured, ['numMatches', 'totalMatches']);

  if (matches !== null && files !== null) {
    return `${matchLabel(matches)} in ${fileLabel(files)}`;
  }
  if (matches !== null) {
    return matchLabel(matches);
  }
  if (files !== null) {
    return fileLabel(files);
  }

  const filenames = (structured as { filenames?: unknown } | null | undefined)?.filenames;
  return Array.isArray(filenames) ? fileLabel(filenames.length) : undefined;
}

/** Whatever the tool's own config would have put on its one-line header. */
function configuredValue(message: ChatMessage, input: unknown): string {
  const config = getToolConfig(message.toolName || 'UnknownTool').input;
  const title = typeof config.title === 'function' ? config.title(input) : config.title;
  const value = config.getValue?.(input);

  return String(value || title || message.displayText || message.content || '').trim();
}

/**
 * Row content for one tool call. Everything comes from the call's own input or
 * result — nothing is guessed when a field is absent.
 */
export function getToolCallSummary(
  message: ChatMessage,
  input: unknown,
  projectPath?: string | null,
): ToolCallSummary {
  const toolName = message.toolName || 'Tool';
  const label = getToolConfig(toolName).input.label || toolName;

  if (FILE_PATH_TOOLS.has(toolName)) {
    const path = readString(input, 'file_path') || readString(input, 'notebook_path');
    return { label, primary: relativizePath(path, projectPath) || configuredValue(message, input) };
  }

  if (toolName === 'Grep' || toolName === 'Glob') {
    return {
      label,
      primary: readString(input, 'pattern') || configuredValue(message, input),
      detail: searchDetail(message),
    };
  }

  if (toolName === 'Bash') {
    return { label, primary: readString(input, 'command') || configuredValue(message, input) };
  }

  return { label, primary: configuredValue(message, input) };
}
