import React from 'react';

import type { Project } from '../../../../types/app';
import type { ChatMessage } from '../../types/types';
import { getToolConfig } from '../configs/toolConfigs';
import type { ToolDiffCalculator } from '../utils/tool-diff-stats';
// Imported by path rather than through the barrel: the barrel is what
// ToolRenderer itself consumes, so routing back into it here would create a
// module cycle.
import { ToolRenderer } from '../ToolRenderer';

import { ToolDiffViewer } from './ToolDiffViewer';
import { ToolOutputBlock } from './ToolOutputBlock';

interface ToolCallDetailProps {
  message: ChatMessage;
  /** Already-parsed `toolInput`, shared with the row summary. */
  input: unknown;
  createDiff: ToolDiffCalculator;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  selectedProject?: Project | null;
  showRawParameters?: boolean;
}

function readString(source: unknown, key: string): string {
  if (!source || typeof source !== 'object') return '';
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

/** The textual body a terminal-style block can render. */
function getOutputText(message: ChatMessage): string {
  const result = message.toolResult;
  if (!result) return '';

  if (typeof result.content === 'string' && result.content.trim()) {
    return result.content;
  }

  const structured = result.toolUseResult;
  if (structured && typeof structured === 'object') {
    const streams = [readString(structured, 'stdout'), readString(structured, 'stderr')]
      .filter((stream) => stream.trim())
      .join('\n');
    if (streams.trim()) return streams;

    const fileContent = readString((structured as { file?: unknown }).file, 'content');
    if (fileContent.trim()) return fileContent;
  }

  if (result.content != null && typeof result.content !== 'string') {
    return JSON.stringify(result.content, null, 2);
  }

  return '';
}

/**
 * Body of an expanded tool row. File mutations keep the existing diff viewer,
 * plain output renders as a line-numbered terminal block, and structurally rich
 * tools (todos, plans, questions) keep their own renderer untouched.
 */
export const ToolCallDetail: React.FC<ToolCallDetailProps> = ({
  message,
  input,
  createDiff,
  onFileOpen,
  selectedProject,
  showRawParameters,
}) => {
  const toolName = message.toolName || 'UnknownTool';
  const displayConfig = getToolConfig(toolName).input;
  const isDiff = displayConfig.contentType === 'diff';
  const isRich =
    displayConfig.type === 'plan' ||
    (displayConfig.type === 'collapsible' && !isDiff && Boolean(displayConfig.contentType) && displayConfig.contentType !== 'text');

  if (isDiff) {
    const contentProps = displayConfig.getContentProps?.(input) || {};
    const oldContent = typeof contentProps.oldContent === 'string' ? contentProps.oldContent : '';
    const newContent = typeof contentProps.newContent === 'string' ? contentProps.newContent : '';

    if (oldContent || newContent) {
      return (
        <div className="bg-background p-2">
          <ToolDiffViewer
            oldContent={oldContent}
            newContent={newContent}
            filePath={String(contentProps.filePath || '')}
            createDiff={createDiff}
            badge={contentProps.badge}
            badgeColor={contentProps.badgeColor}
            onFileClick={
              onFileOpen && contentProps.filePath
                ? () => onFileOpen(contentProps.filePath, { old_string: oldContent, new_string: newContent })
                : undefined
            }
          />
        </div>
      );
    }
  }

  const outputText = getOutputText(message);
  if (!isRich && outputText) {
    return <ToolOutputBlock text={outputText} isError={Boolean(message.toolResult?.isError)} />;
  }

  return (
    <div className="bg-background p-2">
      <ToolRenderer
        toolName={toolName}
        toolInput={message.toolInput}
        toolResult={message.toolResult}
        toolId={message.toolId}
        mode="input"
        onFileOpen={onFileOpen}
        createDiff={createDiff}
        selectedProject={selectedProject}
        showRawParameters={showRawParameters}
        rawToolInput={typeof message.toolInput === 'string' ? message.toolInput : undefined}
      />
    </div>
  );
};
