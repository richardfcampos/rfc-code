import { GitBranch, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Dialog, DialogContent, DialogTitle } from '../../../shared/view/ui';
import { SessionProfileBadge } from '../../profiles';
import { useTaskDetail } from '../hooks/useTaskDetail';
import { useTaskDetailMutations } from '../hooks/useTaskDetailMutations';
import { TASK_BOARD_COLUMNS } from '../utils/taskBoardStages';
import type { TaskStage } from '../types';

import TaskDetailAttachments from './TaskDetailAttachments';
import TaskDetailDescription from './TaskDetailDescription';
import TaskDetailEvidence from './TaskDetailEvidence';
import TaskOriginBadge from './TaskOriginBadge';

type TaskDetailModalProps = {
  taskId: string;
  onClose: () => void;
  onMoveStage: (id: string, stage: TaskStage) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
};

export default function TaskDetailModal({ taskId, onClose, onMoveStage, onDeleteTask }: TaskDetailModalProps) {
  const { t } = useTranslation('taskBoard');
  const { detail, isLoading, loadError, setDetail } = useTaskDetail(taskId, onClose);
  const { updateDescription, uploadAttachment, deleteAttachment, addEvidence, deleteEvidence } =
    useTaskDetailMutations(taskId, setDetail);

  const handleDelete = async () => {
    const confirmed = window.confirm(t('card.confirmDelete', { defaultValue: 'Delete this task?' }));
    if (!confirmed) {
      return;
    }
    try {
      await onDeleteTask(taskId);
      onClose();
    } catch {
      window.alert(t('detail.deleteFailed', { defaultValue: 'Failed to delete task.' }));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[85vh] w-[95vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden p-0"
        onEscapeKeyDown={onClose}
        onPointerDownOutside={onClose}
      >
        <DialogTitle>
          {detail?.task.title || t('detail.title', { defaultValue: 'Task detail' })}
        </DialogTitle>

        {isLoading && !detail && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t('detail.loading', { defaultValue: 'Loading task…' })}
          </div>
        )}

        {loadError && !detail && (
          <div className="p-6 text-center text-sm text-danger">
            {t('detail.loadError', { defaultValue: 'Failed to load this task.' })}
          </div>
        )}

        {detail && (
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-border p-4">
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-base font-semibold text-foreground">{detail.task.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <TaskOriginBadge origin={detail.task.origin} />
                  {detail.task.assignee_profile_id && (
                    <SessionProfileBadge profileId={detail.task.assignee_profile_id} />
                  )}
                  {detail.task.worktree_branch && (
                    <span
                      title={`wt/${detail.task.worktree_branch}`}
                      className="inline-flex min-w-0 max-w-40 items-center gap-1 truncate rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-muted-foreground"
                    >
                      <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
                      <span className="truncate">{detail.task.worktree_branch}</span>
                    </span>
                  )}
                  <select
                    value={detail.task.stage}
                    onChange={(event) => void onMoveStage(taskId, event.target.value as TaskStage)}
                    aria-label={t('card.changeStage', { defaultValue: 'Change stage' })}
                    className="h-6 rounded-ctl border border-input bg-card px-1.5 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {TASK_BOARD_COLUMNS.map((column) => (
                      <option key={column.stage} value={column.stage}>
                        {t(column.labelKey, { defaultValue: column.defaultLabel })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void handleDelete()}
                  title={t('card.delete', { defaultValue: 'Delete' })}
                  aria-label={t('card.delete', { defaultValue: 'Delete' })}
                  className="h-8 w-8 text-muted-foreground hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  title={t('detail.close', { defaultValue: 'Close' })}
                  aria-label={t('detail.close', { defaultValue: 'Close' })}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <TaskDetailDescription description={detail.task.description} onSave={updateDescription} />
              <TaskDetailAttachments
                taskId={taskId}
                attachments={detail.attachments}
                onUpload={uploadAttachment}
                onDelete={deleteAttachment}
              />
              <TaskDetailEvidence evidence={detail.evidence} onAdd={addEvidence} onDelete={deleteEvidence} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
