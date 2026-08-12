import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
} from '../../../../shared/view/ui';

import CommandMenu from './CommandMenu';
import ActivityIndicator from './ActivityIndicator';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import QueuedMessageCard from './QueuedMessageCard';
import ComposerAttachmentTray from './ComposerAttachmentTray';
import ComposerToolbar from './ComposerToolbar';
import ComposerSubmitRow from './ComposerSubmitRow';
import { ComposerDropOverlay, ComposerFileMentions } from './ComposerOverlays';
import type { ChatComposerProps } from './composerTypes';

export type { ChatComposerProps } from './composerTypes';

export default function ChatComposer(props: ChatComposerProps) {
  const {
    pendingPermissionRequests,
    handlePermissionDecision,
    handleGrantToolPermission,
    activity,
    isLoading,
    onAbortSession,
    tokenBudget,
    onSubmit,
    queuedDraft,
    onEditQueuedDraft,
    onDeleteQueuedDraft,
    filteredCommands,
    selectedCommandIndex,
    onCommandSelect,
    onCloseCommandMenu,
    isCommandMenuOpen,
    frequentCommands,
    getRootProps,
    getInputProps,
    inputHighlightRef,
    renderInputWithMentions,
    textareaRef,
    input,
    onVoiceTranscript,
    onInputChange,
    onTextareaClick,
    onTextareaKeyDown,
    onTextareaPaste,
    onTextareaScrollSync,
    onTextareaInput,
    isInputFocused = false,
    onInputFocusChange,
    placeholder,
    isTextareaExpanded,
    sendByCtrlEnter,
  } = props;

  const { t } = useTranslation('chat');
  const commandMenuPosition = useMemo(() => {
    if (!isCommandMenuOpen) {
      return { top: 0, left: 16, bottom: 90 };
    }
    const textareaRect = textareaRef.current?.getBoundingClientRect();
    return {
      top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
      left: textareaRect ? textareaRect.left : 16,
      bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
    };
  }, [isCommandMenuOpen, textareaRef]);

  // Voice state is hosted here (not in the mic button) so the main Send button can stop
  // recording and send the transcript in one tap, the way the mic button drops it in the box.
  const voiceAvailable = useVoiceAvailable();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVoiceError = useCallback((msg: string) => {
    setVoiceError(msg);
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
    voiceErrorTimer.current = setTimeout(() => setVoiceError(null), 4000);
  }, []);
  useEffect(() => () => {
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
  }, []);
  const noopTranscript = useCallback(() => {}, []);
  const { state: voiceState, toggle: voiceToggle, stop: voiceStop } = useVoiceInput(
    onVoiceTranscript ?? noopTranscript,
    handleVoiceError,
  );
  const isRecording = voiceState === 'recording';
  const isTranscribing = voiceState === 'transcribing';
  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  // Hide the thinking/status bar while any permission request is pending
  const hasPendingPermissions = pendingPermissionRequests.length > 0;
  const hasActivityIndicator = Boolean(activity && !hasPendingPermissions);

  // Same data source as before (tokenBudget), just presented as the mock's `ctx 12.4k` chip
  // instead of an icon + count. Click handler is unchanged (onShowTokenUsage).
  const usedContextTokens = useMemo(() => {
    const breakdown = tokenBudget?.breakdown && typeof tokenBudget.breakdown === 'object'
      ? (tokenBudget.breakdown as Record<string, unknown>)
      : null;
    const readNumber = (value: unknown) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const inputTokens = readNumber(tokenBudget?.inputTokens ?? breakdown?.input);
    const outputTokens = readNumber(tokenBudget?.outputTokens ?? breakdown?.output);
    return readNumber(tokenBudget?.used) || inputTokens + outputTokens;
  }, [tokenBudget]);

  const hasQueuedDraft = Boolean(queuedDraft);
  const canQueueDraft = isLoading && Boolean(input.trim());
  // A run in flight frees the textarea for the next message — the mock swaps the idle
  // placeholder for a queueing one for as long as `isLoading` holds.
  const composerPlaceholder = isLoading
    ? t('input.placeholderQueued', { defaultValue: 'Queue your next message…' })
    : placeholder;
  const submitHint = canQueueDraft
    ? hasQueuedDraft
      ? t('input.hintText.updateQueued', { defaultValue: 'Enter to update queued message' })
      : t('input.hintText.queue', { defaultValue: 'Enter to queue your next message' })
    : sendByCtrlEnter
      ? t('input.hintText.ctrlEnter')
      : t('input.hintText.enter');
  const submitAriaLabel = canQueueDraft
    ? hasQueuedDraft
      ? t('input.queue.update', { defaultValue: 'Update queued message' })
      : t('input.queue.sendNext', { defaultValue: 'Queue next message' })
    : isLoading
      ? t('input.stop')
      : t('input.send');

  return (
    // Mobile keeps the composer clear of the home indicator; the app shell above
    // already lifts the whole container by the virtual keyboard's height.
    <div className="chat-composer-shell relative flex-shrink-0 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-0 sm:px-4 sm:pb-4 md:px-4 md:pb-6">
      {!hasPendingPermissions && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 w-[calc(100%-1rem)] max-w-[54.25rem] -translate-x-1/2 translate-y-px bg-transparent sm:w-[calc(100%-2rem)]">
          <ActivityIndicator activity={activity} onAbort={onAbortSession} isInputFocused={isInputFocused} />
        </div>
      )}

      {pendingPermissionRequests.length > 0 && (
        <div className="mx-auto mb-3 max-w-[54.25rem]">
          <PermissionRequestsBanner
            pendingPermissionRequests={pendingPermissionRequests}
            handlePermissionDecision={handlePermissionDecision}
            handleGrantToolPermission={handleGrantToolPermission}
          />
        </div>
      )}

      {queuedDraft && (
        <QueuedMessageCard
          content={queuedDraft.content}
          attachmentCount={queuedDraft.images.length + queuedDraft.files.length}
          onEdit={onEditQueuedDraft}
          onDelete={onDeleteQueuedDraft}
        />
      )}

      {!hasQuestionPanel && <div className="relative mx-auto max-w-[54.25rem]">
        <ComposerFileMentions {...props} />

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <PromptInput
          onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          status={isLoading ? 'streaming' : 'ready'}
          className={[
            isTextareaExpanded ? 'chat-input-expanded' : '',
            hasActivityIndicator ? 'rounded-t-none' : '',
          ].filter(Boolean).join(' ')}
          {...getRootProps()}
        >
          <ComposerDropOverlay {...props} />

          <ComposerAttachmentTray {...props} />

          <input {...getInputProps()} />

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-composer">
              {/* Metrics mirror PromptInputTextarea exactly — any change there must land here too. */}
              <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-3 text-[13px] leading-[1.55] text-transparent">
                {renderInputWithMentions(input)}
              </div>
            </div>

            <PromptInputTextarea
              ref={textareaRef}
              dir="auto"
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={composerPlaceholder}
            />
        </PromptInputBody>

        <PromptInputFooter>
          <ComposerToolbar
            {...props}
            voiceAvailable={voiceAvailable}
            voiceState={voiceState}
            onVoiceToggle={voiceToggle}
            voiceError={voiceError}
            usedContextTokens={usedContextTokens}
          />

          <ComposerSubmitRow
            submitHint={submitHint}
            submitAriaLabel={submitAriaLabel}
            hasText={Boolean(input.trim())}
            canQueueDraft={canQueueDraft}
            isLoading={isLoading}
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            onSubmit={onSubmit}
            onAbortSession={onAbortSession}
            onStopRecordingAndSend={() => voiceStop({ send: true })}
          />
        </PromptInputFooter>
      </PromptInput>
      </div>}
    </div>
  );
}
