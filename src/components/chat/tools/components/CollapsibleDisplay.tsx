import React from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../../../shared/view/ui';
import { CollapsibleSection } from './CollapsibleSection';

interface CollapsibleDisplayProps {
  toolName: string;
  toolId?: string;
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  showRawParameters?: boolean;
  rawContent?: string;
  className?: string;
  toolCategory?: string;
}

const borderColorMap: Record<string, string> = {
  edit: 'border-l-warning',
  search: 'border-l-border-strong',
  bash: 'border-l-success',
  todo: 'border-l-primary',
  task: 'border-l-primary',
  agent: 'border-l-primary',
  plan: 'border-l-primary',
  question: 'border-l-primary',
  default: 'border-l-border',
};

export const CollapsibleDisplay: React.FC<CollapsibleDisplayProps> = ({
  toolName,
  title,
  defaultOpen = false,
  action,
  badge,
  onTitleClick,
  children,
  showRawParameters = false,
  rawContent,
  className = '',
  toolCategory,
}) => {
  const borderColor = borderColorMap[toolCategory || 'default'] || borderColorMap.default;

  return (
    <div className={`border-l-2 ${borderColor} my-1 py-0.5 pl-3 ${className}`}>
      <CollapsibleSection
        title={title}
        toolName={toolName}
        open={defaultOpen}
        action={action}
        badge={badge}
        onTitleClick={onTitleClick}
      >
        {children}

        {showRawParameters && rawContent && (
          <Collapsible className="mt-2">
            <CollapsibleTrigger className="flex items-center gap-1.5 rounded-ctl py-0.5 text-[11px] text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <svg
                className="h-2.5 w-2.5 flex-shrink-0 transition-transform duration-150 data-[state=open]:rotate-90"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              raw params
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-1 overflow-hidden whitespace-pre-wrap break-words rounded-card border border-border bg-background p-2 font-mono text-[11px] leading-[1.75] tracking-wide text-muted-foreground">
                {rawContent}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CollapsibleSection>
    </div>
  );
};
