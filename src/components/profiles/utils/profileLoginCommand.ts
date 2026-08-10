import type { LLMProvider } from '../../../types/app';

// Suggested guided-login command per provider (HUB-05 AC3): typed into the
// profile's terminal, already running with that profile's isolated env, so
// the CLI's OAuth flow writes credentials into the right config dir.
//
// This app is designed to run on a remote host reached over Tailscale (see
// AD-002/native-install) — the terminal above is a browser tab, not a shell
// on the same machine as the CLI. `claude /login` already degrades to a
// paste-a-code flow when it can't reach its own localhost callback, so it
// needs no flag. `codex login` does not: it opens a local HTTP server on
// :1455 and just waits, which hangs forever from a remote browser. Its
// documented fix is `--device-auth` (prints a URL + short code usable from
// any device, no local callback).
const PROVIDER_LOGIN_COMMANDS: Record<LLMProvider, string> = {
  claude: 'claude /login',
  codex: 'codex login --device-auth',
  cursor: 'cursor-agent login',
  opencode: 'opencode auth login',
};

export function getProfileLoginCommand(provider: LLMProvider): string {
  return PROVIDER_LOGIN_COMMANDS[provider] ?? PROVIDER_LOGIN_COMMANDS.claude;
}
