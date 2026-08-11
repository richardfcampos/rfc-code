import { useTranslation } from 'react-i18next';

const loadAllOverlayAnimationStyle = `
@keyframes loadAllOverlayAutoFade {
  0%, 80% { opacity: 1; }
  100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .load-all-overlay-auto-fade {
    animation: none !important;
  }
}
`;

interface LoadAllMessagesOverlayProps {
  showLoadAllOverlay: boolean;
  isLoadingAllMessages: boolean;
  loadAllJustFinished: boolean;
  totalMessages: number;
  onLoadAllMessages: () => void;
}

export default function LoadAllMessagesOverlay({
  showLoadAllOverlay,
  isLoadingAllMessages,
  loadAllJustFinished,
  totalMessages,
  onLoadAllMessages,
}: LoadAllMessagesOverlayProps) {
  const { t } = useTranslation('chat');

  if (!showLoadAllOverlay && !isLoadingAllMessages && !loadAllJustFinished) {
    return null;
  }

  return (
    <div
      className={`pointer-events-none sticky top-2 z-20 flex justify-center ${!isLoadingAllMessages ? 'load-all-overlay-auto-fade' : ''}`}
      style={!isLoadingAllMessages ? { animation: 'loadAllOverlayAutoFade 2500ms ease forwards' } : undefined}
    >
      <style>{loadAllOverlayAnimationStyle}</style>
      {loadAllJustFinished ? (
        <div className="flex items-center gap-2 rounded-ctl border border-[var(--success-line)] bg-[var(--success-tint)] px-3 py-1.5 font-mono text-[11px] font-medium tracking-wide text-success shadow-[var(--shadow-pop)]">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
          <span>{t('session.messages.allLoaded')}</span>
        </div>
      ) : (
        <button
          className="pointer-events-auto flex items-center gap-2 rounded-ctl border border-border bg-card px-3 py-1.5 font-mono text-[11px] font-medium tracking-wide text-muted-foreground shadow-[var(--shadow-pop)] transition-colors duration-150 ease-out hover:border-border-strong hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-75"
          onClick={onLoadAllMessages}
          disabled={isLoadingAllMessages}
        >
          {isLoadingAllMessages && (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-primary" />
          )}
          <span>
            {isLoadingAllMessages
              ? t('session.messages.loadingAll')
              : <>{t('session.messages.loadAll')} {totalMessages > 0 && `(${totalMessages})`}</>}
          </span>
        </button>
      )}
    </div>
  );
}
