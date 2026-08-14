/**
 * Decides how many characters a cross-provider handoff primer may use for a
 * given destination model.
 *
 * There is no registry of context-window sizes anywhere else in this
 * codebase. The only real number available today is codex's
 * `model_context_window`, read at runtime from a live session's rollout
 * metadata (server/modules/providers/list/codex/codex-sessions.provider.ts:131),
 * with its own fallback of 200000 there. This module has no session to read
 * from — it only ever knows a provider name and, optionally, a model name —
 * so it cannot reuse that runtime value. Instead it carries a small, explicit
 * table of publicly documented context windows; anything not in the table
 * falls back to the existing fixed budget rather than guessing.
 */

import { PRIMER_CHAR_BUDGET } from '@/modules/profiles/handoff-primer.js';
import type { LLMProvider } from '@/shared/types.js';

export type PrimerBudgetSource = 'known-window' | 'fallback';

export interface PrimerBudget {
  chars: number;
  source: PrimerBudgetSource;
}

/**
 * Rough tokens-to-characters conversion for English prose. ~4 characters per
 * token is the standard estimate used industry-wide when no exact tokenizer
 * is available for the destination model.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Fraction of the destination's context window the primer may occupy. Capped
 * at roughly a third so most of the window stays free for the turn's own
 * system prompt, tool output and response — the primer is background context
 * handed to the model, not the main event.
 */
const PRIMER_WINDOW_FRACTION = 1 / 3;

/**
 * Context windows, in tokens, for models with a publicly documented number
 * this module's author verified directly. Deliberately small and flat per
 * provider: a (provider, model) pair absent here falls back to
 * PRIMER_CHAR_BUDGET rather than assuming a large window it cannot confirm.
 */
const KNOWN_CONTEXT_WINDOWS: Partial<Record<LLMProvider, Record<string, number>>> = {
  claude: {
    'claude-3-5-sonnet': 200_000,
    'claude-3-7-sonnet': 200_000,
    'claude-opus-4': 200_000,
    'claude-sonnet-4': 200_000,
  },
  codex: {
    'gpt-4.1': 1_047_576,
    'gpt-4o': 128_000,
    o3: 200_000,
  },
};

/**
 * Resolves how many characters the handoff primer for `model` on `provider`
 * may use. Falls back to PRIMER_CHAR_BUDGET — the floor this budget can never
 * drop below — whenever the (provider, model) pair has no documented window,
 * including when `model` is omitted.
 */
export function resolvePrimerBudget(provider: LLMProvider, model?: string): PrimerBudget {
  const windowTokens = model ? KNOWN_CONTEXT_WINDOWS[provider]?.[model] : undefined;
  if (windowTokens === undefined) {
    return { chars: PRIMER_CHAR_BUDGET, source: 'fallback' };
  }

  const derived = Math.floor(windowTokens * CHARS_PER_TOKEN * PRIMER_WINDOW_FRACTION);
  return { chars: Math.max(derived, PRIMER_CHAR_BUDGET), source: 'known-window' };
}
