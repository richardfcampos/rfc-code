const BRANCH_PREFIX = 'wt';
const MAX_SLUG_LENGTH = 32;

/**
 * Derives a worktree branch name from the message that opens a session, so the
 * per-session worktree toggle never has to stop and ask for one.
 *
 * The output is deliberately narrower than what git accepts — lowercase
 * `[a-z0-9-]` only — so it also survives `validateWorktreeBranchName` on the
 * server and `sanitizeBranchForDirectoryName`'s folder mapping unchanged.
 */
export function buildWorktreeBranchName(message: string, fallbackSeed: number): string {
  const slug = message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    // Slicing mid-word can leave a trailing dash behind.
    .replace(/-+$/g, '');

  if (!slug) {
    // Emoji-only or punctuation-only openers slug to nothing; the seed keeps
    // successive fallbacks from colliding on the same branch name.
    return `${BRANCH_PREFIX}/session-${fallbackSeed.toString(36).slice(-5)}`;
  }

  return `${BRANCH_PREFIX}/${slug}`;
}
