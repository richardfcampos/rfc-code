/**
 * Pure title derivation from a prompt: no database, no runtime, no imports.
 * Kept apart from the title service so the transcript synchronizers can use
 * it without pulling the watcher (and through it the provider registry) into
 * their import graph.
 */

/** Longest quick title; word-boundary clipped so the row never ends mid-word. */
const QUICK_TITLE_MAX_CHARS = 80;

/** Issue trackers that put the ticket key in the URL path. */
const TRACKER_URL_PATTERNS = [
  /linear\.app\/[^/\s]+\/issue\/([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/i,
  /atlassian\.net\/browse\/([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/i,
];

/** GitHub pull requests and issues: `owner/repo/pull/123` → `repo#123`. */
const GITHUB_URL_PATTERN = /github\.com\/[^/\s]+\/([^/\s]+)\/(?:pull|issues)\/(\d+)\b/i;

/** Bare `ABC-123` keys; prefixes below are protocol/encoding names, not projects. */
const BARE_TICKET_PATTERN = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
const NOT_A_PROJECT_KEY = new Set(['UTF', 'ISO', 'SHA', 'MD', 'RSA', 'AES', 'HTTP', 'TLS', 'TCP', 'UDP', 'IPV']);

/**
 * The ticket the prompt is about, or null. URL forms win over bare keys so a
 * prompt that pastes a tracker link is named after that link even when the
 * text around it mentions other keys.
 */
export function extractTicketReference(text: string): string | null {
  for (const pattern of TRACKER_URL_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  const github = GITHUB_URL_PATTERN.exec(text);
  if (github) {
    return `${github[1]}#${github[2]}`;
  }

  for (const match of text.matchAll(BARE_TICKET_PATTERN)) {
    if (!NOT_A_PROJECT_KEY.has(match[1].toUpperCase())) {
      return `${match[1].toUpperCase()}-${match[2]}`;
    }
  }

  return null;
}

/** First line of the prompt, whitespace-collapsed and clipped on a word. */
export function deriveQuickTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= QUICK_TITLE_MAX_CHARS) {
    return collapsed;
  }

  const clipped = collapsed.slice(0, QUICK_TITLE_MAX_CHARS);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${lastSpace > QUICK_TITLE_MAX_CHARS / 2 ? clipped.slice(0, lastSpace) : clipped}…`;
}

