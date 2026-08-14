import type { LLMProvider } from '../../../types/app';

// Provider brand names are proper nouns, not translated content — same
// convention as StartSessionPicker/CommandResultModal elsewhere in the app.
// Kept in its own module (rather than exported alongside a component) so
// react-refresh doesn't warn about a non-component export sharing a file.
export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};
