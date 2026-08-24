import { useState } from 'react';
import { Link2, ListChecks, Paperclip, StickyNote, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../shared/view/ui';
import { isHttpUrl } from '../utils/evidenceFormatting';
import type { TaskEvidence, TaskEvidenceKind } from '../types';

type TaskDetailEvidenceProps = {
  evidence: TaskEvidence[];
  onAdd: (kind: TaskEvidenceKind, content: string) => Promise<void>;
  onDelete: (evidenceId: string) => Promise<void>;
};

const EVIDENCE_ICONS: Record<TaskEvidenceKind, typeof StickyNote> = {
  note: StickyNote,
  link: Link2,
  attachment: Paperclip,
};

function EvidenceRow({ item, onDelete }: { item: TaskEvidence; onDelete: (id: string) => Promise<void> }) {
  const { t } = useTranslation('taskBoard');
  const [isDeleting, setIsDeleting] = useState(false);
  const Icon = EVIDENCE_ICONS[item.kind];

  const handleDelete = async () => {
    const confirmed = window.confirm(t('evidence.confirmDelete', { defaultValue: 'Delete this evidence entry?' }));
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    try {
      await onDelete(item.evidence_id);
    } catch {
      window.alert(t('evidence.deleteFailed', { defaultValue: 'Failed to delete evidence.' }));
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex items-start gap-2 rounded-ctl border border-border bg-card p-2">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {item.kind === 'link' && isHttpUrl(item.content) ? (
          <a
            href={item.content}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-sm text-primary hover:underline"
          >
            {item.content}
          </a>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{item.content}</p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => void handleDelete()}
        disabled={isDeleting}
        title={t('evidence.delete', { defaultValue: 'Delete' })}
        aria-label={t('evidence.delete', { defaultValue: 'Delete' })}
        className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default function TaskDetailEvidence({ evidence, onAdd, onDelete }: TaskDetailEvidenceProps) {
  const { t } = useTranslation('taskBoard');
  const [noteValue, setNoteValue] = useState('');
  const [linkValue, setLinkValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (kind: TaskEvidenceKind, content: string, reset: () => void) => {
    const trimmed = content.trim();
    if (!trimmed || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onAdd(kind, trimmed);
      reset();
    } catch {
      window.alert(t('evidence.addFailed', { defaultValue: 'Failed to add evidence.' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <ListChecks className="h-4 w-4" />
        {t('evidence.title', { defaultValue: 'Evidence' })}
      </h3>

      <div className="space-y-2">
        {evidence.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-muted-foreground">
            {t('evidence.empty', { defaultValue: 'No evidence logged yet.' })}
          </p>
        ) : (
          evidence.map((item) => <EvidenceRow key={item.evidence_id} item={item} onDelete={onDelete} />)
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-2 sm:flex-row">
        <div className="flex flex-1 items-center gap-1.5">
          <Input
            value={noteValue}
            onChange={(event) => setNoteValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit('note', noteValue, () => setNoteValue(''));
              }
            }}
            placeholder={t('evidence.notePlaceholder', { defaultValue: 'Add a note…' })}
            aria-label={t('evidence.notePlaceholder', { defaultValue: 'Add a note…' })}
            disabled={isSubmitting}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void submit('note', noteValue, () => setNoteValue(''))}
            disabled={isSubmitting || !noteValue.trim()}
          >
            <StickyNote className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex flex-1 items-center gap-1.5">
          <Input
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit('link', linkValue, () => setLinkValue(''));
              }
            }}
            placeholder={t('evidence.linkPlaceholder', { defaultValue: 'Add a link or file path…' })}
            aria-label={t('evidence.linkPlaceholder', { defaultValue: 'Add a link or file path…' })}
            disabled={isSubmitting}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void submit('link', linkValue, () => setLinkValue(''))}
            disabled={isSubmitting || !linkValue.trim()}
          >
            <Link2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </section>
  );
}
