import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '../../../shared/view/ui';
import type { Project } from '../../../types/app';
import { useAutoPickup } from '../hooks/use-auto-pickup';
// Cross-feature reach: `SettingsToggle` is the only switch control in the
// design system. Default import, mirroring its four existing importers.
import SettingsToggle from '../../settings/view/SettingsToggle';

type AutoPickupToggleProps = {
  project: Project | null;
};

export default function AutoPickupToggle({ project }: AutoPickupToggleProps) {
  const { t } = useTranslation('taskBoard');
  const { enabled, maxConcurrent, isSaving, loadError, setEnabled, setMaxConcurrent } = useAutoPickup(project);
  const [limitInput, setLimitInput] = useState(String(maxConcurrent));

  // Keep the local input in sync whenever the persisted value changes
  // (initial load, or a reload after switching projects).
  useEffect(() => {
    setLimitInput(String(maxConcurrent));
  }, [maxConcurrent]);

  if (!project) {
    return null;
  }

  const commitLimit = () => {
    const parsed = Number(limitInput);
    if (Number.isNaN(parsed)) {
      // Not a number the hook can act on — revert to the last known value
      // rather than silently dropping the edit.
      setLimitInput(String(maxConcurrent));
      return;
    }
    void setMaxConcurrent(parsed).catch(() => {
      // Optimistic value already rolled back inside the hook; `loadError`
      // surfaces the failure.
    });
  };

  return (
    <div className="flex flex-shrink-0 items-center gap-3">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {t('autoPickup.label', { defaultValue: 'Auto-pickup' })}
        <SettingsToggle
          checked={enabled}
          onChange={(next) => {
            void setEnabled(next).catch(() => {
              // Optimistic value already rolled back inside the hook.
            });
          }}
          ariaLabel={t('autoPickup.label', { defaultValue: 'Auto-pickup' })}
          disabled={isSaving}
        />
      </label>

      {enabled && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('autoPickup.limitLabel', { defaultValue: 'Limit' })}
          <Input
            type="number"
            min={1}
            max={10}
            value={limitInput}
            onChange={(event) => setLimitInput(event.target.value)}
            onBlur={commitLimit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            disabled={isSaving}
            className="h-8 w-16 text-right"
          />
        </label>
      )}

      {loadError && (
        <span className="text-xs text-danger">
          {t('autoPickup.error', { defaultValue: 'Could not update auto-pickup' })}
        </span>
      )}
    </div>
  );
}
