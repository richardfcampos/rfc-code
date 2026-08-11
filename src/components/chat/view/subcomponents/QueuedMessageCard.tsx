import { useTranslation } from 'react-i18next';
import { PencilIcon, XIcon } from 'lucide-react';

interface QueuedMessageCardProps {
  content: string;
  attachmentCount?: number;
  onEdit: () => void;
  onDelete: () => void;
}

export default function QueuedMessageCard({ content, attachmentCount = 0, onEdit, onDelete }: QueuedMessageCardProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="settings-content-enter mx-auto mb-2 max-w-[54.25rem] rounded-card border border-dashed border-[var(--accent-line)] bg-[var(--accent-tint)] px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-primary">
            <span>{t('input.queue.label', { defaultValue: 'Queued' })}</span>
            <span className="normal-case text-faint">
              · {t('input.queue.willSend', { defaultValue: 'Will send when this finishes' })}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 break-words text-[13px] leading-[1.55] text-foreground">{content}</p>
          {attachmentCount > 0 && (
            <p className="mt-0.5 font-mono text-[10px] tracking-wide text-faint">
              {attachmentCount} {attachmentCount === 1 ? 'attachment' : 'attachments'} attached
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onEdit}
            aria-label={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
            title={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
            className="rounded-ctl p-1.5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
            title={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
            className="rounded-ctl p-1.5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--danger-tint)] hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
