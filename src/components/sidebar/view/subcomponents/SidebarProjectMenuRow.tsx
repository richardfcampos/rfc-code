import { Check, Edit3, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import type { MCPServerStatus } from '../../types/types';
import { getTaskIndicatorStatus } from '../../utils/utils';

import CodegraphIndicator from './CodegraphIndicator';
import TaskIndicator from './TaskIndicator';

type SidebarProjectMenuRowProps = {
  project: Project;
  isSelected: boolean;
  isStarred: boolean;
  isDeleting: boolean;
  isEditing: boolean;
  editingName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onEditingNameChange: (value: string) => void;
  onSelect: (project: Project) => void;
  onToggleStar: (projectId: string) => void;
  onStartEditing: (project: Project) => void;
  onCancelEditing: () => void;
  onSaveName: (projectId: string) => void;
  onDelete: (project: Project) => void;
  t: TFunction;
};

const ICON_BUTTON_CLASS =
  'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-ctl transition-colors duration-150 ease-out hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function SidebarProjectMenuRow({
  project,
  isSelected,
  isStarred,
  isDeleting,
  isEditing,
  editingName,
  tasksEnabled,
  mcpServerStatus,
  onEditingNameChange,
  onSelect,
  onToggleStar,
  onStartEditing,
  onCancelEditing,
  onSaveName,
  onDelete,
  t,
}: SidebarProjectMenuRowProps) {
  const sessionCount = Number(project.sessionMeta?.total ?? project.sessions?.length ?? 0);

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-1.5 py-1">
        <input
          type="text"
          value={editingName}
          onChange={(event) => onEditingNameChange(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              onSaveName(project.projectId);
            }
            if (event.key === 'Escape') {
              onCancelEditing();
            }
          }}
          className="min-w-0 flex-1 rounded-ctl border border-border bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={t('projects.projectNamePlaceholder')}
          autoFocus
        />
        <button
          className={ICON_BUTTON_CLASS}
          onClick={() => onSaveName(project.projectId)}
          title={t('tooltips.save')}
          aria-label={t('tooltips.save')}
        >
          <Check className="h-3 w-3 text-success" />
        </button>
        <button
          className={ICON_BUTTON_CLASS}
          onClick={onCancelEditing}
          title={t('tooltips.cancel')}
          aria-label={t('tooltips.cancel')}
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group/project flex items-center gap-1 rounded-ctl px-1 transition-colors duration-150 ease-out hover:bg-[var(--hover)]',
        isSelected && 'bg-[var(--accent-tint)]',
        isDeleting && 'pointer-events-none opacity-50',
      )}
    >
      <button
        className={ICON_BUTTON_CLASS}
        onClick={() => onToggleStar(project.projectId)}
        title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
        aria-label={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
        aria-pressed={isStarred}
      >
        <Star className={cn('h-3 w-3', isStarred ? 'fill-current text-warning' : 'text-faint')} />
      </button>

      <button
        // The row's menu item proper — the star/rename/delete buttons beside it
        // are secondary actions on the same project, not separate menu entries.
        role="menuitem"
        className="flex min-w-0 flex-1 flex-col items-start py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSelect(project)}
        aria-current={isSelected ? 'true' : undefined}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-medium leading-5 text-foreground">{project.displayName}</span>
          {tasksEnabled && (
            <TaskIndicator status={getTaskIndicatorStatus(project, mcpServerStatus)} size="xs" className="flex-shrink-0" />
          )}
          <CodegraphIndicator project={project} className="flex-shrink-0" />
          <span className="flex-shrink-0 font-mono text-[10px] tracking-wide text-faint">{sessionCount}</span>
        </span>
        <span className="w-full truncate font-mono text-[10px] tracking-wide text-muted-foreground" title={project.fullPath}>
          {project.fullPath}
        </span>
      </button>

      <div className="flex flex-shrink-0 items-center opacity-100 transition-opacity duration-150 ease-out md:opacity-0 md:group-focus-within/project:opacity-100 md:group-hover/project:opacity-100">
        <button
          className={ICON_BUTTON_CLASS}
          onClick={() => onStartEditing(project)}
          title={t('tooltips.renameProject')}
          aria-label={t('tooltips.renameProject')}
        >
          <Edit3 className="h-3 w-3 text-muted-foreground" />
        </button>
        <button
          className={ICON_BUTTON_CLASS}
          onClick={() => onDelete(project)}
          title={t('tooltips.deleteProject')}
          aria-label={t('tooltips.deleteProject')}
        >
          <Trash2 className="h-3 w-3 text-danger" />
        </button>
      </div>
    </div>
  );
}
