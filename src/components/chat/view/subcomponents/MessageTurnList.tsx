import { memo, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

import type { ChatMessage } from '../../types/types';
import type { Project, LLMProvider } from '../../../../types/app';
import { getIntrinsicMessageKey } from '../../utils/messageKeys';
import { groupConsecutiveTools, isToolGroupItem } from '../../utils/toolGrouping';

import MessageComponent from './MessageComponent';
import ToolGroupContainer from './ToolGroupContainer';
import TurnSummary from './TurnSummary';
import { computeTurnFileStats } from './turnFileStats';

interface MessageTurnListProps {
  visibleMessages: ChatMessage[];
  showThinking?: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  showRawParameters?: boolean;
  selectedProject: Project;
  provider: LLMProvider;
}

/**
 * Renders the grouped message/tool-group list for the active thread, plus a
 * trailing `+N -M K files` summary after any assistant turn that edited
 * files. Extracted from ChatMessagesPane so the pane itself stays focused on
 * loading/pagination chrome.
 */
function MessageTurnList({
  visibleMessages,
  showThinking,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  selectedProject,
  provider,
}: MessageTurnListProps) {
  const groupedVisibleMessages = useMemo(
    () => groupConsecutiveTools(visibleMessages, Boolean(showThinking)),
    [visibleMessages, showThinking],
  );

  // Stable, deterministic keys for the messages rendered this pass.
  //
  // `normalizedToChatMessages` rebuilds fresh ChatMessage objects on every store
  // update, so caching keys by object identity (or via a cross-render allocation
  // Set) minted a brand-new key for the *same* logical message on each prepend —
  // remounting the whole list, which disconnects the scroll-restore anchor and
  // reflows heights, jumping the viewport to the bottom. Deriving keys purely
  // from this render's ordered messages (intrinsic key, disambiguated by
  // occurrence index on collision) yields the same key for the same message
  // order, so React preserves existing DOM nodes and component state on prepend.
  const messageKeyMap = useMemo(() => {
    const keys = new WeakMap<ChatMessage, string>();
    const occurrences = new Map<string, number>();
    const assign = (message: ChatMessage) => {
      const intrinsicKey = getIntrinsicMessageKey(message) ?? 'message-generated';
      const seen = occurrences.get(intrinsicKey) ?? 0;
      occurrences.set(intrinsicKey, seen + 1);
      keys.set(message, seen === 0 ? intrinsicKey : `${intrinsicKey}__${seen}`);
    };
    for (const item of groupedVisibleMessages) {
      if (isToolGroupItem(item)) {
        item.messages.forEach(assign);
      } else {
        assign(item);
      }
    }
    return keys;
  }, [groupedVisibleMessages]);

  const getMessageKey = useCallback(
    (message: ChatMessage) =>
      messageKeyMap.get(message) ?? getIntrinsicMessageKey(message) ?? 'message-generated',
    [messageKeyMap],
  );

  // One file-change summary per assistant turn — the run of non-user
  // messages between two user turns — keyed by the last visibly-rendering
  // message of that turn so it can be dropped in right after it renders.
  const turnStatsByKey = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeTurnFileStats>>();
    let turnMessages: ChatMessage[] = [];
    let turnLastMessage: ChatMessage | null = null;

    const flushTurn = () => {
      if (turnLastMessage) {
        const stats = computeTurnFileStats(turnMessages, createDiff);
        if (stats) {
          map.set(getMessageKey(turnLastMessage), stats);
        }
      }
      turnMessages = [];
      turnLastMessage = null;
    };

    for (const message of visibleMessages) {
      if (message.type === 'user') {
        flushTurn();
        continue;
      }
      turnMessages.push(message);
      if (!(message.isThinking && !showThinking)) {
        turnLastMessage = message;
      }
    }
    flushTurn();

    return map;
  }, [visibleMessages, showThinking, createDiff, getMessageKey]);

  const nodes: ReactNode[] = [];
  let prevMessage: ChatMessage | null = null;

  for (const item of groupedVisibleMessages) {
    if (isToolGroupItem(item)) {
      const groupPrevMessage = prevMessage;
      const lastMessage = item.messages[item.messages.length - 1];
      prevMessage = lastMessage || prevMessage;

      nodes.push(
        <ToolGroupContainer
          key={`tool-group-${getMessageKey(item.messages[0])}`}
          group={item}
          prevMessage={groupPrevMessage}
          createDiff={createDiff}
          getMessageKey={getMessageKey}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={onGrantToolPermission}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          provider={provider}
        />,
      );

      const stats = lastMessage ? turnStatsByKey.get(getMessageKey(lastMessage)) : undefined;
      if (stats) {
        nodes.push(<TurnSummary key={`turn-summary-${getMessageKey(lastMessage)}`} {...stats} />);
      }
      continue;
    }

    const messagePrevMessage = prevMessage;
    prevMessage = item;

    nodes.push(
      <MessageComponent
        key={getMessageKey(item)}
        message={item}
        prevMessage={messagePrevMessage}
        createDiff={createDiff}
        onFileOpen={onFileOpen}
        onShowSettings={onShowSettings}
        onGrantToolPermission={onGrantToolPermission}
        showRawParameters={showRawParameters}
        showThinking={showThinking}
        selectedProject={selectedProject}
        provider={provider}
      />,
    );

    const stats = turnStatsByKey.get(getMessageKey(item));
    if (stats) {
      nodes.push(<TurnSummary key={`turn-summary-${getMessageKey(item)}`} {...stats} />);
    }
  }

  return <>{nodes}</>;
}

export default memo(MessageTurnList);
