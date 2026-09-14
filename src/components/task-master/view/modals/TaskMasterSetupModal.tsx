import { useEffect, useState } from 'react';
import { Loader2, Plus, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';
import type { TaskMasterProject } from '../../types';

type TaskMasterSetupModalProps = {
  isOpen: boolean;
  project: TaskMasterProject | null;
  onClose: () => void;
  onAfterClose?: (() => void) | null;
};

type SetupState = { status: 'running' } | { status: 'done'; output: string } | { status: 'failed'; message: string };

export default function TaskMasterSetupModal({ isOpen, project, onClose, onAfterClose = null }: TaskMasterSetupModalProps) {
  const { t } = useTranslation('tasks');
  const [setupState, setSetupState] = useState<SetupState>({ status: 'running' });
  const [attempt, setAttempt] = useState(0);
  const projectId = project?.projectId;

  // The server runs `task-master init -y` and swaps hosted model providers
  // for CLI ones, so setup needs no terminal interaction from the user.
  useEffect(() => {
    if (!isOpen || !projectId) {
      return;
    }

    let cancelled = false;
    setSetupState({ status: 'running' });

    (async () => {
      try {
        const response = await api.taskmaster.init(projectId);
        const data = (await response.json()) as { message?: string; output?: string };
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          throw new Error(data.message ?? `HTTP ${response.status}`);
        }
        setSetupState({ status: 'done', output: data.output ?? '' });
      } catch (error) {
        if (!cancelled) {
          setSetupState({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt, isOpen, projectId]);

  if (!isOpen || !project) {
    return null;
  }

  const isDone = setupState.status === 'done';

  const closeModal = () => {
    onClose();
    onAfterClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-16 backdrop-blur-sm">
      <div className="flex max-h-[600px] w-full max-w-2xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <Terminal className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('setupModal.title')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('setupModal.subtitle', { projectName: project.displayName })}</p>
            </div>
          </div>

          <button
            onClick={closeModal}
            className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="Close"
          >
            <Plus className="h-5 w-5 rotate-45" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {setupState.status === 'running' && (
            <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('setupModal.willStart')}
            </div>
          )}
          {setupState.status === 'failed' && (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {t('setupModal.failed', { message: setupState.message })}
            </p>
          )}
          {isDone && setupState.output && (
            <pre className="max-h-80 overflow-auto rounded-md bg-black p-3 text-xs text-gray-200">{setupState.output}</pre>
          )}
        </div>

        <div className="border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {isDone && (
                <span className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  {t('setupModal.completed')}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {setupState.status === 'failed' && (
                <button
                  onClick={() => setAttempt((value) => value + 1)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                >
                  {t('setupModal.retryButton')}
                </button>
              )}
              <button
                onClick={closeModal}
                className={cn(
                  'px-4 py-2 text-sm font-medium rounded-md transition-colors',
                  isDone
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600',
                )}
              >
                {isDone ? t('setupModal.closeContinueButton') : t('setupModal.closeButton')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
