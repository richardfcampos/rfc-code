import { useTranslation } from 'react-i18next';

import type { ChatComposerProps } from './composerTypes';

type ComposerModeChipProps = Pick<ChatComposerProps, 'permissionMode' | 'onModeSwitch'>;

/**
 * Permission mode as a semantic signal, not decoration: neutral when nothing is
 * relaxed, success once edits flow on their own, primary for plan mode, warning
 * when permission checks are bypassed. One wash + one line each.
 */
export default function ComposerModeChip({ permissionMode, onModeSwitch }: ComposerModeChipProps) {
  const { t } = useTranslation('chat');

  return (
    <button
      type="button"
      onClick={onModeSwitch}
      className={`inline-flex h-11 shrink-0 items-center rounded-ctl border px-2 font-mono text-[11px] font-medium tracking-wide transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:px-2.5 ${
        permissionMode === 'default'
          ? 'border-border bg-[var(--hover-soft)] text-muted-foreground hover:bg-[var(--hover)]'
          : permissionMode === 'acceptEdits'
            ? 'border-[var(--success-line)] bg-[var(--success-tint)] text-success hover:bg-success/15'
            : permissionMode === 'auto'
              ? 'border-[var(--success-line)] bg-[var(--success-tint)] text-success hover:bg-success/15'
              : permissionMode === 'bypassPermissions'
                ? 'border-[var(--warning-line)] bg-[var(--warning-tint)] text-warning hover:bg-warning/15'
                : 'border-[var(--accent-line)] bg-[var(--accent-tint)] text-primary hover:bg-primary/15'
      }`}
      title={t('input.clickToChangeMode')}
    >
      <div className="flex items-center gap-1.5">
        <div
          className={`h-2.5 w-2.5 rounded-full sm:h-1.5 sm:w-1.5 ${
            permissionMode === 'default'
              ? 'bg-idle'
              : permissionMode === 'acceptEdits'
                ? 'bg-success'
                : permissionMode === 'auto'
                  ? 'bg-success'
                  : permissionMode === 'bypassPermissions'
                    ? 'bg-warning'
                    : 'bg-primary'
          }`}
        />
        {/* Mobile 390 keeps the chip readable at a glance — short label instead of
            hiding it outright, matching the compact composer in the mock. */}
        <span className="whitespace-nowrap sm:hidden">
          {permissionMode === 'default' && t('composer.modeShort.default', { defaultValue: 'Default' })}
          {permissionMode === 'acceptEdits' && t('composer.modeShort.acceptEdits', { defaultValue: 'Edits' })}
          {permissionMode === 'auto' && t('composer.modeShort.auto', { defaultValue: 'Auto' })}
          {permissionMode === 'bypassPermissions' && t('composer.modeShort.bypassPermissions', { defaultValue: 'Bypass' })}
          {permissionMode === 'plan' && t('composer.modeShort.plan', { defaultValue: 'Plan' })}
        </span>
        <span className="hidden whitespace-nowrap sm:inline">
          {permissionMode === 'default' && t('codex.modes.default')}
          {permissionMode === 'acceptEdits' && t('codex.modes.acceptEdits')}
          {permissionMode === 'auto' && t('codex.modes.auto')}
          {permissionMode === 'bypassPermissions' && t('codex.modes.bypassPermissions')}
          {permissionMode === 'plan' && t('codex.modes.plan')}
        </span>
      </div>
    </button>
  );
}
