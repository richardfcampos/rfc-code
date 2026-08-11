import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  TouchEvent,
} from 'react';
import { ImageIcon, MessageSquareIcon, XIcon, Loader2, ArrowUpIcon, GitFork } from 'lucide-react';

import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';
import type { QueuedDraft } from '../../hooks/useChatComposerState';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import type { PendingPermissionRequest, PermissionMode } from '../../types/types';
import type { ProviderModelOption } from '../../../../types/app';
import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '../../../../shared/view/ui';

import CommandMenu from './CommandMenu';
import ActivityIndicator from './ActivityIndicator';
import ImageAttachment from './ImageAttachment';
import FileAttachment from './FileAttachment';
import VoiceInputButton from './VoiceInputButton';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import TokenUsageSummary from './TokenUsageSummary';
import ComposerModelMenu from './ComposerModelMenu';
import ComposerUsagePopover from './ComposerUsagePopover';
import QueuedMessageCard from './QueuedMessageCard';

interface MentionableFile {
  name: string;
  path: string;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  activity: SessionActivity | null;
  isLoading: boolean;
  onAbortSession: () => void;
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  effort: string;
  availableEffortOptions: NonNullable<ProviderModelOption['effort']>['values'];
  onSelectEffort: (effort: string) => void;
  model: string;
  availableModelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  /** Profile behind the active session/provider — passed through to the plan-usage popover. */
  activeProfileId: string | null;
  /** False once a session exists — its working directory is already fixed. */
  canUseWorktree: boolean;
  worktreeEnabled: boolean;
  onToggleWorktree: () => void;
  tokenBudget: Record<string, unknown> | null;
  onShowTokenUsage: () => void;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  queuedDraft: QueuedDraft | null;
  onEditQueuedDraft: () => void;
  onDeleteQueuedDraft: () => void;
  attachedImages: File[];
  onRemoveImage: (index: number) => void;
  attachedFiles: File[];
  onRemoveFile: (index: number) => void;
  uploadingImages: Map<string, number>;
  imageErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openImagePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onVoiceTranscript?: (text: string, send?: boolean) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  isInputFocused?: boolean;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  activity,
  isLoading,
  onAbortSession,
  permissionMode,
  onModeSwitch,
  effort,
  availableEffortOptions,
  onSelectEffort,
  model,
  availableModelOptions,
  onSelectModel,
  modelsLoading,
  activeProfileId,
  canUseWorktree,
  worktreeEnabled,
  onToggleWorktree,
  tokenBudget,
  onShowTokenUsage,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  onSubmit,
  isDragActive,
  queuedDraft,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  attachedImages,
  onRemoveImage,
  attachedFiles,
  onRemoveFile,
  uploadingImages,
  imageErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openImagePicker,
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
}: ChatComposerProps) {
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

  const hasQueuedDraft = Boolean(queuedDraft);
  const canQueueDraft = isLoading && Boolean(input.trim());
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
    <div className="chat-composer-shell relative flex-shrink-0 px-2 pb-2 pt-0 sm:px-4 sm:pb-4 md:px-4 md:pb-6">
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
        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-card border border-border bg-popover shadow-[var(--shadow-pop)]">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`cursor-pointer touch-manipulation border-b border-border px-4 py-3 transition-colors duration-150 ease-out last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-[var(--accent-tint)] text-primary'
                    : 'text-foreground hover:bg-[var(--hover)]'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-[13px] font-medium">{file.name}</div>
                <div className="font-mono text-[10px] tracking-wide text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

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
          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-composer border border-dashed border-[var(--accent-line)] bg-[var(--accent-tint)]">
              <div className="rounded-card border border-border bg-card p-4 shadow-[var(--shadow-pop)]">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-[13px] font-medium text-foreground">Drop files here</p>
              </div>
            </div>
          )}

          {(attachedImages.length > 0 || attachedFiles.length > 0) && (
            <PromptInputHeader>
              <div className="rounded-card bg-[var(--hover-soft)] p-2">
                <div className="flex flex-wrap gap-2">
                  {attachedImages.map((file, index) => (
                    <ImageAttachment
                      key={`image-${index}`}
                      file={file}
                      onRemove={() => onRemoveImage(index)}
                      uploadProgress={uploadingImages.get(file.name)}
                      error={imageErrors.get(file.name)}
                    />
                  ))}
                  {attachedFiles.map((file, index) => (
                    <FileAttachment
                      key={`file-${index}`}
                      file={file}
                      onRemove={() => onRemoveFile(index)}
                      error={imageErrors.get(file.name)}
                    />
                  ))}
                </div>
              </div>
            </PromptInputHeader>
          )}

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
              placeholder={placeholder}
            />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputButton
              tooltip={{ content: t('input.attachFiles') }}
              onClick={openImagePicker}
            >
              <ImageIcon />
            </PromptInputButton>

            {onVoiceTranscript && voiceAvailable && (
              <VoiceInputButton state={voiceState} onToggle={voiceToggle} errorMsg={voiceError} />
            )}

            {/* Mode is a semantic signal, not decoration: neutral when nothing is
                relaxed, success once edits flow on their own, primary for plan mode,
                warning when permission checks are bypassed. One wash + one line each. */}
            <button
              type="button"
              onClick={onModeSwitch}
              className={`inline-flex h-8 shrink-0 items-center rounded-ctl border px-2 font-mono text-[11px] font-medium tracking-wide transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5 ${
                permissionMode === 'default'
                  ? 'border-border bg-[var(--hover-soft)] text-muted-foreground hover:bg-[var(--hover)]'
                  : permissionMode === 'acceptEdits'
                    ? 'border-[var(--success-line)] bg-[var(--success-tint)] text-success hover:bg-success/15'
                    : permissionMode === 'auto'
                      ? 'border-[var(--success-line)] bg-[var(--success-tint)] text-success hover:bg-success/15'
                      : permissionMode === 'bypassPermissions'
                        ? 'border-[var(--warning-line)] bg-[var(--warning-tint)] text-warning hover:bg-warning/15'
                        : 'border-[var(--accent-line)] bg-[var(--accent-tint)] text-primary hover:bg-primary/15'
              }`}
              title={t('input.clickToChangeMode')}
            >
              <div className="flex items-center gap-1.5">
                <div
                  className={`h-2.5 w-2.5 rounded-full sm:h-1.5 sm:w-1.5 ${
                    permissionMode === 'default'
                      ? 'bg-idle'
                      : permissionMode === 'acceptEdits'
                        ? 'bg-success'
                        : permissionMode === 'auto'
                          ? 'bg-success'
                          : permissionMode === 'bypassPermissions'
                            ? 'bg-warning'
                            : 'bg-primary'
                  }`}
                />
                <span className="hidden whitespace-nowrap sm:inline">
                  {permissionMode === 'default' && t('codex.modes.default')}
                  {permissionMode === 'acceptEdits' && t('codex.modes.acceptEdits')}
                  {permissionMode === 'auto' && t('codex.modes.auto')}
                  {permissionMode === 'bypassPermissions' && t('codex.modes.bypassPermissions')}
                  {permissionMode === 'plan' && t('codex.modes.plan')}
                </span>
              </div>
            </button>

            {canUseWorktree && (
              <button
                type="button"
                onClick={onToggleWorktree}
                role="switch"
                aria-checked={worktreeEnabled}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-ctl border px-2 font-mono text-[11px] font-medium tracking-wide transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5 ${
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

            <ComposerUsagePopover activeProfileId={activeProfileId} />

            <TokenUsageSummary usage={tokenBudget} onClick={onShowTokenUsage} />

            <PromptInputButton
              tooltip={{ content: t('input.showAllCommands') }}
              onClick={onToggleCommandMenu}
              className="relative"
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

          <div className="flex items-center gap-2">
            <div
              className={`hidden whitespace-nowrap text-[11px] text-faint transition-opacity duration-150 ease-out lg:block ${
                input.trim() && !canQueueDraft ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {submitHint}
            </div>
            <PromptInputSubmit
              onClick={
                canQueueDraft
                  ? (e: MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      onSubmit(e);
                    }
                  : isLoading
                    ? onAbortSession
                    : isRecording
                      ? (e: MouseEvent<HTMLButtonElement>) => {
                          e.preventDefault();
                          voiceStop({ send: true });
                        }
                      : undefined
              }
              disabled={isLoading ? false : isRecording ? false : isTranscribing ? true : !input.trim()}
              aria-label={submitAriaLabel}
              title={submitAriaLabel}
              className="h-11 w-11 sm:h-8 sm:w-8"
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : canQueueDraft ? (
                <ArrowUpIcon className="h-4 w-4" />
              ) : undefined}
            </PromptInputSubmit>
          </div>
        </PromptInputFooter>
      </PromptInput>
      </div>}
    </div>
  );
}
