import { Bell, Loader2, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '../../../../../shared/view/ui';
import { useNotifyHubSettings } from '../../../hooks/useNotifyHubSettings';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

export default function NotifyHubSettingsCard() {
  const { t } = useTranslation('settings');
  const {
    view,
    form,
    updateForm,
    isLoading,
    isSaving,
    isTesting,
    loadFailed,
    saveStatus,
    testResult,
    save,
    test,
  } = useNotifyHubSettings();

  const statusLabel = view.configured
    ? t('notifications.notifyHub.status.configured', { defaultValue: 'Configured' })
    : t('notifications.notifyHub.status.notConfigured', { defaultValue: 'Not configured' });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-blue-600" />
            <h4 className="font-medium text-foreground">
              {t('notifications.notifyHub.title', { defaultValue: 'notify-hub push' })}
            </h4>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('notifications.notifyHub.description', {
              defaultValue:
                'Send a push to your phone through your notify-hub when a run finishes, fails, or waits for you. Turn it on per project with the bell in the sidebar.',
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={view.configured ? 'default' : 'outline'}>{statusLabel}</Badge>
          {view.source === 'env' && (
            <Badge variant="secondary">
              {t('notifications.notifyHub.status.fromEnv', { defaultValue: 'from environment variables' })}
            </Badge>
          )}
        </div>
      </div>

      {loadFailed && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {t('notifications.notifyHub.loadError', { defaultValue: 'Could not load notify-hub settings.' })}
        </p>
      )}

      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t('notifications.notifyHub.url', { defaultValue: 'URL' })}
          </span>
          <input
            type="url"
            className={inputClass}
            placeholder="http://localhost:8080/notify"
            value={form.url}
            disabled={isLoading}
            onChange={(event) => updateForm('url', event.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t('notifications.notifyHub.token', { defaultValue: 'Token' })}
          </span>
          <input
            type="password"
            autoComplete="off"
            className={inputClass}
            placeholder={view.hasToken && view.tokenHint ? view.tokenHint : 'paste token'}
            value={form.token}
            disabled={isLoading}
            onChange={(event) => updateForm('token', event.target.value)}
          />
          <span className="block text-xs text-muted-foreground">
            {t('notifications.notifyHub.tokenKeep', { defaultValue: 'Leave empty to keep the current token' })}
          </span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t('notifications.notifyHub.timezone', { defaultValue: 'Timezone' })}
          </span>
          <input
            type="text"
            className={inputClass}
            placeholder="America/Sao_Paulo"
            value={form.timezone}
            disabled={isLoading}
            onChange={(event) => updateForm('timezone', event.target.value)}
          />
          <span className="block text-xs text-muted-foreground">
            {t('notifications.notifyHub.timezoneHint', { defaultValue: 'IANA name, used for the time in the message' })}
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" size="sm" disabled={isSaving || isLoading} onClick={() => void save()}>
          {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSaving
            ? t('notifications.notifyHub.saving', { defaultValue: 'Saving...' })
            : t('notifications.notifyHub.save', { defaultValue: 'Save' })}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!view.configured || isSaving || isTesting}
          onClick={() => void test()}
        >
          {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {isTesting
            ? t('notifications.notifyHub.testing', { defaultValue: 'Testing...' })
            : t('notifications.notifyHub.test', { defaultValue: 'Test' })}
        </Button>

        {saveStatus && (
          <span
            className={
              saveStatus.type === 'success'
                ? 'text-sm text-green-600 dark:text-green-400'
                : 'text-sm text-red-600 dark:text-red-400'
            }
          >
            {saveStatus.type === 'success'
              ? t('notifications.notifyHub.saved', { defaultValue: 'Saved' })
              : saveStatus.message || t('notifications.notifyHub.loadError', { defaultValue: 'Could not save notify-hub settings.' })}
          </span>
        )}

        {testResult && (
          <span
            className={
              testResult.ok
                ? 'text-sm text-green-600 dark:text-green-400'
                : 'text-sm text-red-600 dark:text-red-400'
            }
          >
            {testResult.ok
              ? t('notifications.notifyHub.testSent', {
                  defaultValue: 'Test sent (HTTP {{status}})',
                  status: testResult.status ?? '—',
                })
              : t('notifications.notifyHub.testFailed', {
                  defaultValue: 'Test failed: {{error}}',
                  error: testResult.error || 'unknown error',
                })}
          </span>
        )}
      </div>
    </div>
  );
}
