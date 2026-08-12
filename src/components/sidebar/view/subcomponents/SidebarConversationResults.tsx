import { type ReactNode } from 'react';
import { Folder, MessageSquare, Search } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { ConversationSearchResults, SearchProgress } from '../../hooks/useSidebarController';

type SidebarConversationResultsProps = {
  conversationResults: ConversationSearchResults | null;
  isSearching: boolean;
  searchProgress: SearchProgress | null;
  // The server emits a null projectId when it cannot resolve a project row for
  // the hit; consumers must handle that case.
  onConversationResultClick: (
    projectId: string | null,
    sessionId: string,
    provider: string,
    messageTimestamp?: string | null,
    messageSnippet?: string | null,
  ) => void;
  t: TFunction;
};

function HighlightedSnippet({ snippet, highlights }: { snippet: string; highlights: { start: number; end: number }[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const highlight of highlights) {
    if (highlight.start > cursor) {
      parts.push(snippet.slice(cursor, highlight.start));
    }
    parts.push(
      <mark key={highlight.start} className="rounded-sm bg-[var(--warning-tint)] px-0.5 text-foreground">
        {snippet.slice(highlight.start, highlight.end)}
      </mark>,
    );
    cursor = highlight.end;
  }
  if (cursor < snippet.length) {
    parts.push(snippet.slice(cursor));
  }
  return <span className="min-w-0 flex-1 break-words text-xs leading-relaxed text-muted-foreground">{parts}</span>;
}

export default function SidebarConversationResults({
  conversationResults,
  isSearching,
  searchProgress,
  onConversationResultClick,
  t,
}: SidebarConversationResultsProps) {
  const hasResults = Boolean(conversationResults && conversationResults.results.length > 0);

  if (isSearching && !hasResults) {
    return (
      <div className="px-4 py-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-card bg-muted">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
        <p className="text-sm text-muted-foreground">{t('search.searching')}</p>
        {searchProgress && (
          <p className="mt-1 font-mono text-[10px] tracking-wide text-faint">
            {searchProgress.scannedProjects}/{searchProgress.totalProjects}
          </p>
        )}
      </div>
    );
  }

  if (!isSearching && conversationResults && conversationResults.results.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-card bg-muted">
          <Search className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-1 text-base font-medium text-foreground">{t('search.noResults')}</h3>
        <p className="text-sm text-muted-foreground">{t('search.tryDifferentQuery')}</p>
      </div>
    );
  }

  if (!conversationResults || !hasResults) {
    return null;
  }

  return (
    <div className="space-y-3 px-2 py-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted-foreground">
          {t('search.matches', { count: conversationResults.totalMatches })}
        </p>
        {isSearching && searchProgress && (
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-primary" />
            <p className="font-mono text-[10px] tracking-wide text-faint">
              {searchProgress.scannedProjects}/{searchProgress.totalProjects}
            </p>
          </div>
        )}
      </div>

      {conversationResults.results.map((projectResult) => (
        <div key={projectResult.projectName} className="space-y-1">
          <div className="flex items-center gap-1.5 px-1 py-1">
            <Folder className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
            <span className="truncate text-xs text-foreground">{projectResult.projectDisplayName}</span>
          </div>
          {projectResult.sessions.map((session) => (
            <button
              key={`${projectResult.projectId ?? projectResult.projectName}-${session.sessionId}`}
              className="w-full rounded-ctl px-2 py-2 text-left transition-colors duration-150 ease-out hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onConversationResultClick(
                projectResult.projectId,
                session.sessionId,
                session.provider || session.matches[0]?.provider || 'claude',
                session.matches[0]?.timestamp,
                session.matches[0]?.snippet,
              )}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <MessageSquare className="h-3 w-3 flex-shrink-0 text-primary" />
                <span className="truncate text-xs text-foreground">{session.sessionSummary}</span>
                {session.provider && session.provider !== 'claude' && (
                  <span className="flex-shrink-0 rounded-ctl bg-muted px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                    {session.provider}
                  </span>
                )}
              </div>
              <div className="space-y-1 pl-4">
                {session.matches.map((match, index) => (
                  <div key={index} className="flex items-start gap-1">
                    <span className="mt-0.5 flex-shrink-0 font-mono text-[10px] uppercase tracking-wide text-faint">
                      {match.role === 'user' ? 'U' : 'A'}
                    </span>
                    <HighlightedSnippet snippet={match.snippet} highlights={match.highlights} />
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
