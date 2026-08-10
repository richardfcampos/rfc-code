// Picks which account profiles take part, and what each of them runs on.
// Selection order is meaningful: in review mode the first pick authors and the
// second reviews, so the assigned role is shown on the row instead of being
// implied. Profiles from more than one provider can share a run, so each row
// states which provider it is and offers that provider's own model catalog.
//
// The row is a container rather than one big button because a selected seat
// carries its own model menu, and a button cannot legally contain another one.

import { useTranslation } from 'react-i18next';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { DEFAULT_PARTICIPANT_SETTINGS } from '../../types';
import type { CollabModelCatalog } from '../../hooks/use-collab-model-catalog';
import type { CollabParticipantSettings, CollabProfileOption } from '../../types';

import CollabParticipantModelMenu from './CollabParticipantModelMenu';

type CollabParticipantPickerProps = {
  profiles: CollabProfileOption[];
  selectedIds: string[];
  selectionCap: number;
  loadError: string | null;
  roleFor: (profileId: string) => string | undefined;
  onToggle: (profileId: string) => void;
  models: CollabModelCatalog;
  settingsFor: (profileId: string) => CollabParticipantSettings;
  onSelectModel: (profileId: string, model: string) => void;
  onSelectEffort: (profileId: string, effort: string) => void;
};

export default function CollabParticipantPicker({
  profiles, selectedIds, selectionCap, loadError, roleFor, onToggle,
  models, settingsFor, onSelectModel, onSelectEffort,
}: CollabParticipantPickerProps) {
  const { t } = useTranslation('collab');

  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-foreground">
        {t('form.participants', { defaultValue: 'Participants' })} ({selectedIds.length}/{selectionCap})
      </span>

      {loadError && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{loadError}</p>}
      {models.error && <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">{models.error}</p>}

      <div className="space-y-2">
        {profiles.map((profile) => {
          const isSelected = selectedIds.includes(profile.id);
          const settings = isSelected ? settingsFor(profile.id) : DEFAULT_PARTICIPANT_SETTINGS;

          return (
            <div
              key={profile.id}
              className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors ${
                isSelected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-border bg-card/50'
              }`}
            >
              <button
                type="button"
                onClick={() => onToggle(profile.id)}
                disabled={!isSelected && selectedIds.length >= selectionCap}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-40"
                aria-pressed={isSelected}
              >
                {/* The logo alone carries no text for assistive tech, so the
                    provider name is spelled out next to it. */}
                <SessionProviderLogo provider={profile.provider} className="h-4 w-4 flex-shrink-0" />
                <span className="truncate text-sm text-foreground">{profile.name}</span>
                <span className="flex-shrink-0 text-xs capitalize text-muted-foreground">
                  {profile.provider}
                </span>
              </button>

              {isSelected && (
                <span className="flex flex-shrink-0 items-center gap-2">
                  <span className="rounded-md border border-border px-2 py-0.5 text-[10px] font-semibold capitalize text-foreground">
                    {roleFor(profile.id) ?? t('form.roleParticipant', { defaultValue: 'participant' })}
                  </span>
                  <CollabParticipantModelMenu
                    profileName={profile.name}
                    model={settings.model}
                    modelOptions={models.optionsFor(profile.provider)}
                    modelsLoading={models.loading}
                    effort={settings.effort}
                    onSelectModel={(model) => onSelectModel(profile.id, model)}
                    onSelectEffort={(effort) => onSelectEffort(profile.id, effort)}
                  />
                </span>
              )}
            </div>
          );
        })}

        {profiles.length === 0 && !loadError && (
          <p className="text-xs text-muted-foreground">
            {t('form.noProfiles', {
              defaultValue: 'No Claude or Codex profiles yet. Create and authenticate two in Settings › Profiles.',
            })}
          </p>
        )}
      </div>
    </div>
  );
}
