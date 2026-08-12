import { useTranslation } from 'react-i18next';
import { ImageIcon, MessageSquareIcon, XIcon, GitFork } from 'lucide-react';

import { PromptInputTools, PromptInputButton } from '../../../../shared/view/ui';
import type { VoiceInputState } from '../../hooks/useVoiceInput';

import VoiceInputButton from './VoiceInputButton';
import ComposerModelMenu from './ComposerModelMenu';
import ComposerModeChip from './ComposerModeChip';
import ComposerUsagePopover from './ComposerUsagePopover';
import type { ChatComposerProps } from './composerTypes';

type ComposerToolbarProps = Pick<
  ChatComposerProps,
  | 'openImagePicker'
  | 'onVoiceTranscript'
  | 'permissionMode'
  | 'onModeSwitch'
  | 'canUseWorktree'
  | 'worktreeEnabled'
  | 'onToggleWorktree'
  | 'effort'
  | 'availableEffortOptions'
  | 'onSelectEffort'
  | 'model'
  | 'availableModelOptions'
  | 'onSelectModel'
  | 'modelsLoading'
  | 'activeProfileId'
  | 'onShowTokenUsage'
  | 'slashCommandsCount'
  | 'onToggleCommandMenu'
  | 'hasInput'
  | 'onClearInput'
> & {
  voiceAvailable: boolean;
  voiceState: VoiceInputState;
  onVoiceToggle: () => void;
  voiceError: string | null;
  usedContextTokens: number;
};

/** Formats the composer's `ctx` chip — e.g. `12.4k` — mirroring the mock's mono usage label. */
function formatContextTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

// Icon-only buttons are the composer's smallest targets, so mobile lifts them
// to 44px and hands the 32px rail back at `sm` and up.
const MOBILE_TAP_TARGET = 'h-11 w-11 sm:h-8 sm:w-8';

/** Chip row under the textarea: attachments, voice, mode, model, usage, commands. */
export default function ComposerToolbar({
  openImagePicker,
  onVoiceTranscript,
  voiceAvailable,
  voiceState,
  onVoiceToggle,
  voiceError,
  permissionMode,
  onModeSwitch,
  canUseWorktree,
  worktreeEnabled,
  onToggleWorktree,
  effort,
  availableEffortOptions,
  onSelectEffort,
  model,
  availableModelOptions,
  onSelectModel,
  modelsLoading,
  activeProfileId,
  onShowTokenUsage,
  usedContextTokens,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
}: ComposerToolbarProps) {
  const { t } = useTranslation('chat');

  return (
    <PromptInputTools>
      <PromptInputButton
        tooltip={{ content: t('input.attachFiles') }}
        onClick={openImagePicker}
        className={MOBILE_TAP_TARGET}
      >
        <ImageIcon />
      </PromptInputButton>

      {onVoiceTranscript && voiceAvailable && (
        <span className="inline-flex [&_button]:h-11 [&_button]:w-11 sm:[&_button]:h-8 sm:[&_button]:w-8">
          <VoiceInputButton state={voiceState} onToggle={onVoiceToggle} errorMsg={voiceError} />
        </span>
      )}

      <ComposerModeChip permissionMode={permissionMode} onModeSwitch={onModeSwitch} />

      {canUseWorktree && (
        <button
          type="button"
          onClick={onToggleWorktree}
          role="switch"
          aria-checked={worktreeEnabled}
          className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-ctl border px-2 font-mono text-[11px] font-medium tracking-wide transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:px-2.5 ${
            worktreeEnabled
              ? 'border-[var(--accent-line-strong)] bg-[var(--accent-tint)] text-primary'
              : 'border-border bg-[var(--hover-soft)] text-muted-foreground hover:bg-[var(--hover)]'
          }`}
          title={t('composer.worktreeHint', {
            defaultValue: 'Run this session in its own git worktree',
          })}
        >
          <GitFork className="h-3.5 w-3.5" />
          <span className="hidden whitespace-nowrap sm:inline">
            {t('composer.worktree', { defaultValue: 'Worktree' })}
          </span>
        </button>
      )}

      <ComposerModelMenu
        effort={effort}
        effortOptions={availableEffortOptions}
        onSelectEffort={onSelectEffort}
        model={model}
        modelOptions={availableModelOptions}
        onSelectModel={onSelectModel}
        modelsLoading={modelsLoading}
      />

      {/* Usage gauge is a desktop/tablet affordance — the mock's mobile composer keeps
          only Plan / model / ctx so the row fits above the keyboard. */}
      <div className="hidden sm:inline-flex">
        <ComposerUsagePopover activeProfileId={activeProfileId} />
      </div>

      <button
        type="button"
        onClick={onShowTokenUsage}
        className="inline-flex h-11 shrink-0 items-center gap-1 rounded-ctl border border-border bg-[var(--hover-soft)] px-2 font-mono text-[11px] font-medium tracking-wide text-muted-foreground transition-colors duration-150 ease-out hover:border-border-strong hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:px-2.5"
        title={`${usedContextTokens.toLocaleString()} tokens used`}
        aria-label="Show token usage"
      >
        <span className="text-faint">ctx</span>
        <span className="text-foreground">{formatContextTokens(usedContextTokens)}</span>
      </button>

      <PromptInputButton
        tooltip={{ content: t('input.showAllCommands') }}
        onClick={onToggleCommandMenu}
        className="relative hidden sm:inline-flex"
      >
        <MessageSquareIcon />
        {slashCommandsCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-medium tracking-wide text-primary-foreground"
          >
            {slashCommandsCount}
          </span>
        )}
      </PromptInputButton>

      {hasInput && (
        <PromptInputButton
          tooltip={{ content: t('input.clearInput', { defaultValue: 'Clear input' }) }}
          onClick={onClearInput}
          className="hidden sm:flex"
        >
          <XIcon />
        </PromptInputButton>
      )}
    </PromptInputTools>
  );
}
