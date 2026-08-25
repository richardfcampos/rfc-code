/**
 * Finding the machine-readable half of an answer written for a human.
 *
 * A council turn is an ordinary chat turn: the model writes prose and is asked
 * to end it with one JSON object. No provider here offers a structured-output
 * channel that works across Claude and Codex alike, so the object arrives inside
 * the same text stream as the argument, and something has to pick it back out.
 *
 * Extraction is deliberately forgiving and deliberately last-wins. Models quote
 * the requested template while explaining themselves, wrap the block in a fence
 * they label `json`, `JSON` or nothing at all, and occasionally answer with the
 * bare object and no prose around it. The *last* balanced object in the text is
 * the one the model committed to; anything earlier is illustration.
 */

/** Fenced blocks, with an optional language tag we do not care about. */
const FENCED_BLOCK = /```[a-zA-Z]*\s*\n([\s\S]*?)```/g;

/**
 * Walks the text backwards from each `}` looking for the `{` that balances it,
 * ignoring braces inside strings. A regex cannot do this — nested objects are
 * exactly what the contract contains — and a greedy `\{[\s\S]*\}` would swallow
 * prose sitting between two unrelated objects.
 */
function lastBalancedObject(text: string): string | null {
  for (let end = text.lastIndexOf('}'); end >= 0; end = text.lastIndexOf('}', end - 1)) {
    let depth = 0;
    let inString = false;

    for (let index = end; index >= 0; index -= 1) {
      const character = text[index];

      if (character === '"') {
        // Scanning backwards, a quote only toggles the string state when it is
        // not itself escaped, which the run of backslashes before it decides.
        let backslashes = 0;
        while (index - 1 - backslashes >= 0 && text[index - 1 - backslashes] === '\\') backslashes += 1;
        if (backslashes % 2 === 0) inString = !inString;
        continue;
      }
      if (inString) continue;

      if (character === '}') depth += 1;
      if (character === '{') {
        depth -= 1;
        if (depth === 0) return text.slice(index, end + 1);
      }
    }
  }

  return null;
}

function parseObject(candidate: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(candidate);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The last JSON object in a turn, or `null` when the turn carries none.
 *
 * Fenced blocks win over loose text: a model that fenced its answer told us
 * where the contract is, and prose that merely mentions `{`…`}` should not be
 * able to outrank it.
 */
export function extractJsonObject(content: string): Record<string, unknown> | null {
  if (typeof content !== 'string' || !content.trim()) return null;

  const fenced = [...content.matchAll(FENCED_BLOCK)].map((match) => match[1]);
  for (const block of fenced.reverse()) {
    const parsed = parseObject(block.trim()) ?? parseObject(lastBalancedObject(block) ?? '');
    if (parsed) return parsed;
  }

  const direct = parseObject(content.trim());
  if (direct) return direct;

  const balanced = lastBalancedObject(content);
  return balanced ? parseObject(balanced) : null;
}
