import { useEffect, useState } from 'react';
import { Pencil, Save, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/view/ui';
import { Markdown } from '../../chat/view/subcomponents/Markdown';

type TaskDetailDescriptionProps = {
  description: string | null;
  onSave: (description: string) => Promise<void>;
};

export default function TaskDetailDescription({ description, onSave }: TaskDetailDescriptionProps) {
  const { t } = useTranslation('taskBoard');
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');
  const [isSaving, setIsSaving] = useState(false);

  // A `task_update` WS refresh (or switching to a different task) can replace
  // the description out from under an unopened editor — keep the draft synced
  // whenever it isn't actively being typed into.
  useEffect(() => {
    if (!isEditing) {
      setDraft(description ?? '');
    }
  }, [description, isEditing]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(draft);
      setIsEditing(false);
    } catch {
      window.alert(t('description.saveFailed', { defaultValue: 'Failed to save description.' }));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {t('description.title', { defaultValue: 'Description' })}
        </h3>
        {isEditing ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void handleSave()}
              disabled={isSaving}
              title={t('description.save', { defaultValue: 'Save' })}
              aria-label={t('description.save', { defaultValue: 'Save' })}
              className="h-7 w-7 text-primary"
            >
              <Save className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setDraft(description ?? '');
                setIsEditing(false);
              }}
              disabled={isSaving}
              title={t('description.cancel', { defaultValue: 'Cancel' })}
              aria-label={t('description.cancel', { defaultValue: 'Cancel' })}
              className="h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsEditing(true)}
            title={t('description.edit', { defaultValue: 'Edit' })}
            aria-label={t('description.edit', { defaultValue: 'Edit' })}
            className="h-7 w-7"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isEditing ? (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={6}
          disabled={isSaving}
          placeholder={t('description.placeholder', { defaultValue: 'Markdown supported…' })}
          className="w-full resize-y rounded-ctl border border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : description ? (
        <Markdown className="text-sm">{description}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('description.empty', { defaultValue: 'No description yet.' })}
        </p>
      )}
    </section>
  );
}
