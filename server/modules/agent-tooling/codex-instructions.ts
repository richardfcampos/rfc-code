/**
 * Global instructions for Codex profiles.
 *
 * Codex reads `$CODEX_HOME/AGENTS.md` before the repository's own AGENTS.md
 * chain, and CODEX_HOME is the profile dir, so this is the one place that
 * reaches every Codex session of a profile without editing client repos. Two
 * rules ride here: prefer the CodeGraph index over grep when the repo has one,
 * and use the shared memory dir handed over through `RFC_MEMORY_DIR`.
 *
 * The block is fenced by markers and rewritten in place, so anything the user
 * adds outside the markers survives.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isCodegraphAvailable } from '@/modules/agent-tooling/codegraph-settings.js';

export const CODEX_INSTRUCTIONS_FILE = 'AGENTS.md';

const START_MARKER = '<!-- rfc-code:managed:start -->';
const END_MARKER = '<!-- rfc-code:managed:end -->';

const CODEGRAPH_RULE = `## CodeGraph — default tool for code understanding

If the repository root has a \`.codegraph/\` directory, run
\`codegraph explore "<symbols or question>"\` BEFORE grep/rg/find or reading
files whenever you need to locate code, check callers before editing, trace a
flow across layers, or onboard to an unfamiliar area. One call returns the
verbatim source plus call paths. Shell search is fine for non-indexed content
(.env, JSON, Markdown, YAML, SQL) or when \`.codegraph/\` is absent.`;

const MEMORY_RULE = `## Shared memory

When the environment variable \`RFC_MEMORY_DIR\` is set, that directory is the
project memory shared with the other coding agents on this machine.
- At the start of a task, read \`$RFC_MEMORY_DIR/MEMORY.md\` if it exists; it
  is an index, one line per memory file, and each file holds one fact.
- When you learn something durable that the repository itself does not record
  (a user preference, a correction, a constraint, an external pointer), save
  it as \`$RFC_MEMORY_DIR/<kebab-slug>.md\` with a YAML frontmatter of
  \`name\`, \`description\` and \`metadata.type\` (user | feedback | project |
  reference), then append \`- [Title](<file>.md) — hook\` to \`MEMORY.md\`.
  Create the directory if it does not exist yet.
- Update an existing file instead of adding a duplicate; never put memory
  content into \`MEMORY.md\` itself.`;

export function buildCodexManagedBlock(options: { codegraph: boolean }): string {
  const sections = [options.codegraph ? CODEGRAPH_RULE : null, MEMORY_RULE].filter(Boolean);
  return `${START_MARKER}\n${sections.join('\n\n')}\n${END_MARKER}\n`;
}

/** Replaces the managed block, or appends one when the file has none. */
export function mergeManagedBlock(existing: string, block: string): string {
  const start = existing.indexOf(START_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (start !== -1 && end !== -1 && end > start) {
    const after = existing.slice(end + END_MARKER.length).replace(/^\n/, '');
    return `${existing.slice(0, start)}${block}${after}`;
  }
  const trimmed = existing.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

/** Writes the managed block into `<profileDir>/AGENTS.md`. */
export function applyCodexGlobalInstructions(profileDir: string): void {
  const filePath = path.join(profileDir, CODEX_INSTRUCTIONS_FILE);
  let existing = '';
  try {
    existing = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const next = mergeManagedBlock(existing, buildCodexManagedBlock({ codegraph: isCodegraphAvailable() }));
  if (next === existing) {
    return;
  }
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(filePath, next);
}
