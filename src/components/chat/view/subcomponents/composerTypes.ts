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

import type { QueuedDraft } from '../../hooks/useChatComposerState';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import type { PendingPermissionRequest, PermissionMode } from '../../types/types';
import type { LLMProvider, ProviderModelOption } from '../../../../types/app';
import type { Profile } from '../../../profiles/types';
import type { PendingProviderSwitch, ProviderSwitchOutcome } from '../../hooks/useProviderSwitch';

export interface MentionableFile {
  name: string;
  path: string;
}

export interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Wires the composer's Provider/Account menu section to the switch decision
 * owned by `useProviderSwitch`. Optional end to end (`ChatComposerProps` ->
 * `ComposerToolbarProps` -> `ComposerModelMenu`) so the composer renders
 * exactly as before wherever a caller does not supply it yet.
 */
export interface ComposerAccountSectionProps {
  /** Provider currently serving the session, or the locally selected one when no session is open. */
  provider: LLMProvider;
  /** Every known account, grouped by provider — loaded once by useChatProviderState. */
  profilesByProvider: Partial<Record<LLMProvider, Profile[]>>;
  /** Account id currently serving the session (or locally selected); null while unknown. */
  selectedProfileId: string | null;
  /** Requests a switch to this account; resolves once the local/API decision is known. */
  onSelectAccount: (profile: Profile) => Promise<ProviderSwitchOutcome>;
  /** Cross-provider switch awaiting explicit confirmation, or null. */
  pendingConfirmation: PendingProviderSwitch | null;
  onConfirmSwitch: () => void;
  onCancelSwitch: () => void;
  isSwitching: boolean;
  /** Error from the last switch attempt (e.g. target account not authenticated). */
  switchError: string | null;
}

export interface ChatComposerProps {
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
  /** Drives the composer menu's Provider/Account section; absent hides that section entirely. */
  accountSection?: ComposerAccountSectionProps;
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
