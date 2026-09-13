/**
 * Links the bundled kit into the config directory profile-less sessions use.
 *
 * Sessions that are not bound to an account profile run against the provider
 * CLI's own default directory, so the kit has to reach there too — otherwise
 * the agents and rules shipped with the app are invisible to anyone who has not
 * created a profile, which is the default state of a fresh install.
 *
 * Hooks are deliberately left out of this path. On a native install that
 * directory is the user's real `~/.claude`, and its `settings.json` is theirs:
 * linking a file in adds something they can ignore, while registering a hook
 * makes our scripts run on every tool call of every session they start outside
 * this app. Profiles get the hooks, because those directories only exist
 * because this app created them.
 */

import { resolveDefaultClaudeConfigDir } from '@/modules/bundled-skills/index.js';
import { isAgentKitAvailable, linkKitContent } from '@/modules/bundled-kit/bundled-kit.js';

/** Runs at startup, best effort: a read-only home means "no bundled agents". */
export function ensureDefaultConfigDirKit(): void {
  try {
    if (!isAgentKitAvailable()) {
      return;
    }
    linkKitContent(resolveDefaultClaudeConfigDir());
  } catch (error) {
    console.warn(
      '[agent-kit] Could not link the bundled kit into the default config directory:',
      error instanceof Error ? error.message : error,
    );
  }
}
