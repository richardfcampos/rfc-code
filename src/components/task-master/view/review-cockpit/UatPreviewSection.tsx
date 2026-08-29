import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Play, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { api } from '../../../../utils/api';

type PreviewStatus = {
  status: 'installing' | 'starting' | 'ready' | 'stopped' | 'failed';
  url?: string | null;
  error?: string | null;
  logs?: string[];
};

type PreviewConfig = {
  command: string;
  setup_command?: string | null;
  bind_host?: string | null;
  port?: number | null;
};

type UatPreviewSectionProps = {
  /** DB project id — the task-master cockpit's identifier. */
  projectId?: string;
  /** Explicit repository path — the Review Center's identifier. */
  projectPath?: string;
  /** Worktree to boot in; defaults to the project root server-side. */
  cwd?: string;
};

const POLL_INTERVAL_MS = 1000;

/**
 * UAT block state flow:
 *   idle ──Run──▶ no config? ──▶ config form ──Save & run──▶ booting
 *          └─▶ booting (installing… → starting…) ──▶ ready (URL) ──Stop──▶ idle
 *                                              └──▶ failed (error + log tail)
 */
export default function UatPreviewSection({ projectId = '', projectPath, cwd }: UatPreviewSectionProps) {
  const { t } = useTranslation('tasks');

  const [preview, setPreview] = useState<PreviewStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [configDraft, setConfigDraft] = useState<PreviewConfig>({ command: '' });
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    const response = await api.preview.status(projectId, { cwd, projectPath });
    if (response.ok) {
      const status = (await response.json()) as PreviewStatus;
      setPreview(status);
      if (!['installing', 'starting'].includes(status.status)) {
        stopPolling();
      }
    }
  }, [projectId, projectPath, cwd, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      void refreshStatus();
    }, POLL_INTERVAL_MS);
  }, [refreshStatus, stopPolling]);

  useEffect(() => {
    void refreshStatus();
    return stopPolling;
  }, [refreshStatus, stopPolling]);

  const handleRun = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      const response = await api.preview.start(projectId, { cwd, projectPath });
      if (response.status === 400) {
        const payload = (await response.json()) as { code?: string };
        if (payload.code === 'NO_CONFIG') {
          const configResponse = await api.preview.getConfig(projectId, { projectPath });
          const { suggested } = (await configResponse.json()) as {
            suggested: { command: string; setupCommand?: string } | null;
          };
          setConfigDraft({
            command: suggested?.command ?? '',
            setup_command: suggested?.setupCommand ?? '',
          });
          setShowConfigForm(true);
          return;
        }
      }
      setPreview((await response.json()) as PreviewStatus);
      startPolling();
    } catch (error) {
      console.error('Failed to start preview:', error);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveAndRun = async () => {
    if (isBusy || !configDraft.command.trim()) return;
    setIsBusy(true);
    try {
      const saveResponse = await api.preview.saveConfig(projectId, {
        command: configDraft.command,
        setupCommand: configDraft.setup_command ?? null,
        bindHost: configDraft.bind_host ?? null,
        port: configDraft.port ?? null,
        projectPath,
      });
      if (!saveResponse.ok) {
        const payload = (await saveResponse.json()) as { error?: string };
        setPreview({ status: 'failed', error: payload.error ?? 'Invalid config' });
        return;
      }
      setShowConfigForm(false);
      const response = await api.preview.start(projectId, { cwd, projectPath });
      setPreview((await response.json()) as PreviewStatus);
      startPolling();
    } catch (error) {
      console.error('Failed to save preview config:', error);
    } finally {
      setIsBusy(false);
    }
  };

  const handleStop = async () => {
    if (isBusy) return;
    stopPolling();
    const response = await api.preview.stop(projectId, { cwd, projectPath });
    if (response.ok) {
      setPreview((await response.json()) as PreviewStatus);
    }
  };

  const isBooting = preview?.status === 'installing' || preview?.status === 'starting';
  const isReady = preview?.status === 'ready' && preview.url;
  const isFailed = preview?.status === 'failed';
  const logs = preview?.logs ?? [];

  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('cockpit.uat')}
          {isReady && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
              {t('cockpit.uatReady')}
            </span>
          )}
        </span>

        {!isBooting && !isReady && (
          <button
            onClick={() => void handleRun()}
            disabled={isBusy}
            className="flex min-h-[44px] items-center gap-2 rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-800 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Play className="h-4 w-4" />
            {t('cockpit.uatRun')}
          </button>
        )}

        {(isBooting || isReady) && (
          <button
            onClick={() => void handleStop()}
            className="flex min-h-[44px] items-center gap-2 rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-800 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Square className="h-4 w-4" />
            {t('cockpit.uatStop')}
          </button>
        )}
      </div>

      {isBooting && (
        <p className="mt-3 animate-pulse text-sm text-gray-500 dark:text-gray-400">
          {preview?.status === 'installing' ? t('cockpit.uatInstalling') : t('cockpit.uatStarting')}
        </p>
      )}

      {isReady && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={preview.url ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[44px] items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <ExternalLink className="h-4 w-4" />
            {t('cockpit.uatOpen')}
          </a>
          <button
            onClick={() => void copyTextToClipboard(preview.url ?? '')}
            className="flex min-h-[44px] items-center gap-2 rounded-md border border-gray-300 px-4 font-mono text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            title={t('cockpit.uatCopy')}
          >
            {preview.url}
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {isFailed && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          {t('cockpit.uatFailed')}: {preview?.error}
        </p>
      )}

      {(isFailed || isBooting || isReady) && logs.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowLogs((current) => !current)}
            className="text-xs text-gray-500 underline dark:text-gray-400"
          >
            {t('cockpit.uatLogs')}
          </button>
          {showLogs && (
            <pre className="mt-2 max-h-40 overflow-y-auto rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {logs.slice(-40).join('\n')}
            </pre>
          )}
        </div>
      )}

      {showConfigForm && (
        <div className="mt-4 space-y-3 border-t border-gray-200 pt-3 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('cockpit.cfgTitle')}</p>

          <label className="block text-xs text-gray-500 dark:text-gray-400">
            {t('cockpit.cfgCommand')}
            <input
              type="text"
              value={configDraft.command}
              onChange={(event) => setConfigDraft({ ...configDraft, command: event.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder="npm run dev -- --host $HOST --port $PORT"
            />
            <span className="mt-1 block">{t('cockpit.cfgCommandHint')}</span>
          </label>

          <label className="block text-xs text-gray-500 dark:text-gray-400">
            {t('cockpit.cfgSetup')}
            <input
              type="text"
              value={configDraft.setup_command ?? ''}
              onChange={(event) => setConfigDraft({ ...configDraft, setup_command: event.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder="npm install"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-gray-500 dark:text-gray-400">
              {t('cockpit.cfgBindHost')}
              <input
                type="text"
                value={configDraft.bind_host ?? ''}
                onChange={(event) => setConfigDraft({ ...configDraft, bind_host: event.target.value })}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <label className="block text-xs text-gray-500 dark:text-gray-400">
              {t('cockpit.cfgPort')}
              <input
                type="number"
                value={configDraft.port ?? ''}
                onChange={(event) =>
                  setConfigDraft({ ...configDraft, port: event.target.value === '' ? null : Number(event.target.value) })
                }
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void handleSaveAndRun()}
              disabled={isBusy || !configDraft.command.trim()}
              className={cn(
                'min-h-[44px] rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50',
              )}
            >
              {t('cockpit.cfgSave')}
            </button>
            <button
              onClick={() => setShowConfigForm(false)}
              className="min-h-[44px] rounded-md px-4 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t('cockpit.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
