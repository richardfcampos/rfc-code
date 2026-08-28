import { useEffect, useState } from 'react';
import { Check, Undo2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import { api, authenticatedFetch } from '../../../../utils/api';
import { useTaskMaster } from '../../context/TaskMasterContext';
import type { TaskMasterTask } from '../../types';

import UatPreviewSection from './UatPreviewSection';

type ReviewCockpitDrawerProps = {
  task: TaskMasterTask | null;
  isOpen: boolean;
  onClose: () => void;
};

type GitStatusFile = { path?: string; file?: string };
type GitStatus = {
  branch?: string;
  modified?: (string | GitStatusFile)[];
  added?: (string | GitStatusFile)[];
  deleted?: (string | GitStatusFile)[];
  untracked?: (string | GitStatusFile)[];
};

function fileLabel(entry: string | GitStatusFile): string {
  return typeof entry === 'string' ? entry : (entry.path ?? entry.file ?? '');
}

/**
 * Review decision loop this drawer drives:
 *
 *   review ──[Approve]──────────▶ done
 *   review ──[Request changes]──▶ in-progress ──(agent works, sets review)──▶ review
 *   review ──[Run UAT]──────────▶ review (preview boots, decision stays pending)
 */
export default function ReviewCockpitDrawer({ task, isOpen, onClose }: ReviewCockpitDrawerProps) {
  const { t } = useTranslation('tasks');
  const { currentProject, refreshTasks } = useTaskMaster();

  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [busyAction, setBusyAction] = useState<'approve' | 'feedback' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const projectId = typeof currentProject?.name === 'string' ? currentProject.name : '';

  useEffect(() => {
    setFeedbackText('');
    setShowFeedbackForm(false);
    setErrorMessage(null);
    setGitStatus(null);

    if (!isOpen || !projectId) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch(`/api/git/status?project=${encodeURIComponent(projectId)}`);
        if (response.ok && !cancelled) {
          setGitStatus((await response.json()) as GitStatus);
        }
      } catch {
        // Evidence is best-effort; decisions never depend on it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId, task?.id]);

  if (!isOpen || !task) {
    return null;
  }

  const changedFiles = [
    ...(gitStatus?.modified ?? []),
    ...(gitStatus?.added ?? []),
    ...(gitStatus?.deleted ?? []),
    ...(gitStatus?.untracked ?? []),
  ]
    .map(fileLabel)
    .filter(Boolean);

  const setStatus = async (status: string) => {
    const response = await api.taskmaster.updateTask(projectId, task.id, { status });
    if (!response.ok) {
      const payload = (await response.json()) as { message?: string; error?: string };
      throw new Error(payload.message ?? payload.error ?? 'Failed to update task status');
    }
  };

  const handleApprove = async () => {
    if (busyAction || !projectId) return;
    if (!window.confirm(t('cockpit.approveConfirm'))) return;

    setBusyAction('approve');
    setErrorMessage(null);
    try {
      await setStatus('done');
      await refreshTasks();
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRequestChanges = async () => {
    if (busyAction || !projectId || !feedbackText.trim()) return;

    setBusyAction('feedback');
    setErrorMessage(null);
    try {
      // Feedback lands inside the task itself (task-master update-task), so
      // the agent that picks the task back up sees it without any session
      // linkage. Status flips afterwards; if the feedback write fails the
      // task stays in review and the text stays in the box.
      const feedbackResponse = await api.taskmaster.updateTask(projectId, task.id, {
        prompt: `Review feedback from the user — address before returning to review: ${feedbackText.trim()}`,
      });
      if (!feedbackResponse.ok) {
        const payload = (await feedbackResponse.json()) as { message?: string; error?: string };
        throw new Error(payload.message ?? payload.error ?? 'Failed to record feedback');
      }

      await setStatus('in-progress');
      await refreshTasks();
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={t('cockpit.title')}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-purple-600 dark:text-purple-400">
              {t('cockpit.title')} · {String(task.id)}
            </p>
            <h2 className="mt-1 line-clamp-2 text-lg font-semibold text-gray-900 dark:text-white">{task.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            title={t('cockpit.cancel')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {task.description && (
            <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{task.description}</p>
          )}

          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('cockpit.evidence')}
              {gitStatus?.branch ? (
                <span className="ml-2 font-mono text-xs text-gray-500 dark:text-gray-400">{gitStatus.branch}</span>
              ) : null}
            </p>
            {changedFiles.length > 0 ? (
              <>
                <ul className="mt-2 space-y-1">
                  {changedFiles.slice(0, 20).map((file) => (
                    <li key={file} className="truncate font-mono text-xs text-gray-600 dark:text-gray-400">
                      {file}
                    </li>
                  ))}
                  {changedFiles.length > 20 && (
                    <li className="text-xs text-gray-500 dark:text-gray-400">+{changedFiles.length - 20}</li>
                  )}
                </ul>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('cockpit.openGitTab')}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('cockpit.noEvidence')}</p>
            )}
          </div>

          {projectId && <UatPreviewSection projectId={projectId} />}

          {errorMessage && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
        </div>

        <div className="border-t border-gray-200 p-4 dark:border-gray-700">
          {showFeedbackForm ? (
            <div className="space-y-3">
              <textarea
                rows={3}
                autoFocus
                value={feedbackText}
                onChange={(event) => setFeedbackText(event.target.value)}
                placeholder={t('cockpit.feedbackPlaceholder')}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void handleRequestChanges()}
                  disabled={busyAction !== null || !feedbackText.trim()}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                >
                  <Undo2 className="h-4 w-4" />
                  {busyAction === 'feedback' ? t('cockpit.sending') : t('cockpit.feedbackSend')}
                </button>
                <button
                  onClick={() => setShowFeedbackForm(false)}
                  disabled={busyAction !== null}
                  className="min-h-[44px] rounded-md px-4 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {t('cockpit.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => void handleApprove()}
                disabled={busyAction !== null}
                className={cn(
                  'flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50',
                )}
              >
                <Check className="h-4 w-4" />
                {t('cockpit.approve')}
              </button>
              <button
                onClick={() => setShowFeedbackForm(true)}
                disabled={busyAction !== null}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                <Undo2 className="h-4 w-4" />
                {t('cockpit.requestChanges')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
