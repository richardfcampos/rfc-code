import type { LLMProvider } from '../../../types/app';

// Suggested guided-login command per provider (HUB-05 AC3): typed into the
// profile's terminal, already running with that profile's isolated env, so
// the CLI's OAuth flow writes credentials into the right config dir.
const PROVIDER_LOGIN_COMMANDS: Record<LLMProvider, string> = {
  claude: 'claude /login',
  codex: 'codex login',
  cursor: 'cursor-agent login',
  opencode: 'opencode auth login',
};

export function getProfileLoginCommand(provider: LLMProvider): string {
  return PROVIDER_LOGIN_COMMANDS[provider] ?? PROVIDER_LOGIN_COMMANDS.claude;
}
