import { forwardRef } from 'react';
import { Check, Edit2, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';

type SidebarSessionRowActionsProps = {
  isEditing: boolean;
  isProcessing: boolean;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSave: () => void;
  onDelete: () => void;
  t: TFunction;
};

const ACTION_BUTTON_CLASS =
  'flex h-6 w-6 items-center justify-center rounded-ctl transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Rename/delete cluster overlaying the right edge of a session row. Always
 * visible on touch, hover-revealed on desktop so the row stays quiet.
 */
const SidebarSessionRowActions = forwardRef<HTMLDivElement, SidebarSessionRowActionsProps>(
  function SidebarSessionRowActions({
    isEditing,
    isProcessing,
    editingSessionName,
    onEditingSessionNameChange,
    onStartEditing,
    onCancelEditing,
    onSave,
    onDelete,
    t,
  }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'absolute right-1.5 top-1.5 flex items-center gap-1 transition-opacity duration-150 ease-out',
          isEditing
            ? 'opacity-100'
            : 'opacity-100 focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100',
        )}
      >
        {isEditing ? (
          <>
            <input
              type="text"
              value={editingSessionName}
              onChange={(event) => onEditingSessionNameChange(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  onSave();
                } else if (event.key === 'Escape') {
                  onCancelEditing();
                }
              }}
              onClick={(event) => event.stopPropagation()}
              className="w-32 rounded-ctl border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
            <button
              className={cn(ACTION_BUTTON_CLASS, 'bg-success/10 hover:bg-success/20')}
              onClick={(event) => {
                event.stopPropagation();
                onSave();
              }}
              title={t('tooltips.save')}
              aria-label={t('tooltips.save')}
            >
              <Check className="h-3 w-3 text-success" />
            </button>
            <button
              className={cn(ACTION_BUTTON_CLASS, 'bg-[var(--hover)] hover:bg-muted')}
              onClick={(event) => {
                event.stopPropagation();
                onCancelEditing();
              }}
              title={t('tooltips.cancel')}
              aria-label={t('tooltips.cancel')}
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </>
        ) : (
          <>
            <button
              className={cn(ACTION_BUTTON_CLASS, 'bg-[var(--hover)] hover:bg-muted')}
              onClick={(event) => {
                event.stopPropagation();
                onStartEditing();
              }}
              title={t('tooltips.editSessionName')}
              aria-label={t('tooltips.editSessionName')}
            >
              <Edit2 className="h-3 w-3 text-muted-foreground" />
            </button>
            {!isProcessing && (
              <button
                className={cn(ACTION_BUTTON_CLASS, 'bg-[var(--danger-tint)] hover:bg-danger/20')}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                title={t('tooltips.deleteSessionOptions', 'Archive or permanently delete this session')}
                aria-label={t('tooltips.deleteSessionOptions', 'Archive or permanently delete this session')}
              >
                <Trash2 className="h-3 w-3 text-danger" />
              </button>
            )}
          </>
        )}
      </div>
    );
  },
);

export default SidebarSessionRowActions;
