// Work surface for multi-account collaborations of the active project: the list
// of past and running debates, and the entry point to start a new one. Opening
// one swaps this view for the transcript, which is where polling happens.

import { useState } from 'react';
import { Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '../../../shared/view/ui';
import { useCollaborations } from '../hooks/useCollaborations';
import type { CollaborationSummary } from '../types';

import CollabDetail from './CollabDetail';
import CreateCollabModal from './modals/CreateCollabModal';
import CollabStatusBadge from './subcomponents/CollabStatusBadge';

type CollabPanelProps = {
  projectPath: string;
  /** Opens the settings dialog on a given tab — used by the cost warning. */
  onShowSettings?: (tab?: 'profiles') => void;
};

export default function CollabPanel({ projectPath, onShowSettings }: CollabPanelProps) {
  const { t } = useTranslation('collab');
  const {
    collaborations, isLoading, loadError, actionError, refresh, createCollaboration, deleteCollaboration,
  } = useCollaborations(projectPath);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  if (selectedId) {
    return (
      <CollabDetail
        collaborationId={selectedId}
        onBack={() => {
          setSelectedId(null);
          // The run may have advanced or finished while it was open.
          void refresh();
        }}
      />
    );
  }

  const handleDelete = async (collaboration: CollaborationSummary) => {
    const confirmed = window.confirm(t('list.confirmDelete', {
      defaultValue: 'Delete this collaboration and its turns?',
    }));
    if (confirmed) {
      await deleteCollaboration(collaboration.id);
    }
  };

  const handleCreate = async (input: Parameters<typeof createCollaboration>[0]) => {
    const created = await createCollaboration(input);
    // Close explicitly instead of relying on the modal's own teardown: this view
    // is replaced by the transcript on the very next render.
    setIsCreateOpen(false);
    setSelectedId(created.id);
  };

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 flex-shrink-0 text-purple-500" />
            <div className="min-w-0 space-y-1">
              <h3 className="text-lg font-medium text-foreground">
                {t('list.title', { defaultValue: 'Collaborations' })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('list.description', {
                  defaultValue: 'Let two or more accounts discuss a topic in this project until they reach a verdict.',
                })}
              </p>
            </div>
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={() => setIsCreateOpen(true)} className="flex-1 sm:flex-none">
              <Plus className="mr-2 h-4 w-4" />
              {t('list.new', { defaultValue: 'New collaboration' })}
            </Button>
          </div>
        </div>

        {(loadError || actionError) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
            {actionError || loadError}
          </div>
        )}

        <div className="space-y-2">
          {isLoading && collaborations.length === 0 && (
            <p className="py-8 text-center text-muted-foreground">
              {t('list.loading', { defaultValue: 'Loading collaborations…' })}
            </p>
          )}

          {collaborations.map((collaboration) => (
            <div key={collaboration.id} className="rounded-lg border border-border bg-card/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedId(collaboration.id)}
                  className="min-h-[44px] min-w-0 flex-1 py-1 text-left"
                >
                  <span className="line-clamp-2 text-sm font-medium text-foreground">
                    {collaboration.topic}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {collaboration.participants.map((participant) => participant.profileName).join(' · ')}
                  </span>
                </button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(collaboration)}
                  className="flex-shrink-0 text-red-600 hover:text-red-700"
                  title={t('list.delete', { defaultValue: 'Delete' })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CollabStatusBadge status={collaboration.status} />
                <Badge variant="outline" className="text-[10px] capitalize">{collaboration.mode}</Badge>
                <span className="text-xs text-muted-foreground">
                  {t('list.roundProgress', {
                    current: collaboration.currentRound,
                    max: collaboration.maxRounds,
                    defaultValue: 'Round {{current}}/{{max}}',
                  })}
                </span>
              </div>
            </div>
          ))}

          {!isLoading && collaborations.length === 0 && !loadError && (
            <p className="py-8 text-center text-muted-foreground">
              {t('list.empty', { defaultValue: 'No collaborations in this project yet.' })}
            </p>
          )}
        </div>
      </div>

      <CreateCollabModal
        isOpen={isCreateOpen}
        projectPath={projectPath}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreate}
        onOpenProfileSettings={onShowSettings ? () => onShowSettings('profiles') : undefined}
      />
    </div>
  );
}
