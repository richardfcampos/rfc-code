import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Folder, FolderPlus, RefreshCw, Search } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import type { MCPServerStatus } from '../../types/types';
import { filterProjects } from '../../utils/utils';

import SidebarProjectMenuRow from './SidebarProjectMenuRow';

export type SidebarProjectSelectorProps = {
  projects: Project[];
  selectedProject: Project | null;
  deletingProjects: Set<string>;
  editingProject: string | null;
  editingName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  isRefreshing: boolean;
  isProjectStarred: (projectId: string) => boolean;
  onEditingNameChange: (value: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectId: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectId: string) => void;
  onDeleteProject: (project: Project) => void;
  onCreateProject: () => void;
  onRefresh: () => void;
  t: TFunction;
};

const MENU_ACTION_CLASS =
  'flex flex-1 items-center justify-center gap-1.5 rounded-ctl px-2 py-1.5 text-xs text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function SidebarProjectSelector({
  projects,
  selectedProject,
  deletingProjects,
  editingProject,
  editingName,
  tasksEnabled,
  mcpServerStatus,
  isRefreshing,
  isProjectStarred,
  onEditingNameChange,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onCreateProject,
  onRefresh,
  t,
}: SidebarProjectSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        // Escape leaves focus stranded on a removed node otherwise, dropping
        // keyboard users back to the top of the document.
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const visibleProjects = filterProjects(projects, projectQuery);
  const triggerLabel = selectedProject?.displayName ?? t('projects.title');

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-ctl border border-border px-2.5 text-left transition-colors duration-150 ease-out hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setIsOpen((previous) => !previous)}
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t('projects.title')}
      >
        <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="min-w-0 max-w-[60%] truncate text-xs font-medium text-foreground">{triggerLabel}</span>
        {selectedProject?.fullPath && (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[10px] tracking-wide text-muted-foreground"
            title={selectedProject.fullPath}
          >
            {selectedProject.fullPath}
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform duration-150 ease-out',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-card border border-border bg-card shadow-[var(--shadow-pop)]"
          // A menu, not a listbox: the rows are action buttons (select, star,
          // rename, delete), not single-select options, so `listbox` made
          // screen readers announce an empty list.
          role="menu"
          aria-label={t('projects.title')}
        >
          {projects.length > 6 && (
            <div className="relative border-b border-border p-1.5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
              <input
                type="text"
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder={t('projects.searchPlaceholder')}
                className="h-7 w-full rounded-ctl bg-[var(--hover-soft)] pl-7 pr-2 text-xs text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                autoFocus
              />
            </div>
          )}

          <div className="max-h-72 overflow-y-auto p-1">
            {visibleProjects.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {projects.length === 0 ? t('projects.noProjects') : t('projects.noMatchingProjects')}
              </p>
            ) : (
              visibleProjects.map((project) => (
                <SidebarProjectMenuRow
                  key={project.projectId}
                  project={project}
                  isSelected={selectedProject?.projectId === project.projectId}
                  isStarred={isProjectStarred(project.projectId)}
                  isDeleting={deletingProjects.has(project.projectId)}
                  isEditing={editingProject === project.projectId}
                  editingName={editingName}
                  tasksEnabled={tasksEnabled}
                  mcpServerStatus={mcpServerStatus}
                  onEditingNameChange={onEditingNameChange}
                  onSelect={(candidate) => {
                    onProjectSelect(candidate);
                    setIsOpen(false);
                  }}
                  onToggleStar={onToggleStarProject}
                  onStartEditing={onStartEditingProject}
                  onCancelEditing={onCancelEditingProject}
                  onSaveName={onSaveProjectName}
                  onDelete={(candidate) => {
                    onDeleteProject(candidate);
                    setIsOpen(false);
                  }}
                  t={t}
                />
              ))
            )}
          </div>

          <div className="flex items-center gap-1 border-t border-border p-1">
            <button
              type="button"
              className={MENU_ACTION_CLASS}
              onClick={() => {
                onCreateProject();
                setIsOpen(false);
              }}
              title={t('tooltips.createProject')}
            >
              <FolderPlus className="h-3 w-3" />
              {t('projects.newProject')}
            </button>
            <button
              type="button"
              className={MENU_ACTION_CLASS}
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
              {t('actions.refresh')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
