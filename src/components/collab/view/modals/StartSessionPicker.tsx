// Account/model/effort controls of the "start a session from this verdict"
// modal. Split out so the modal file keeps only the flow (create session, seed
// the composer, navigate) and this file only the form.

import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';
import type { LLMProvider, ProviderModelOption } from '../../../../types/app';
import { DEFAULT_EFFORT_VALUE } from '../../../chat/constants/providerEffort';
import type { CollabProfileOption } from '../../types';

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

const PROVIDER_OPTIONS = Object.keys(PROVIDER_LABELS) as LLMProvider[];

const FIELD_CLASS =
  'min-h-[44px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:ring-blue-500';

type StartSessionPickerProps = {
  provider: LLMProvider;
  profileId: string | null;
  model: string;
  effort: string;
  profiles: CollabProfileOption[];
  modelOptions: ProviderModelOption[];
  effortValues: { value: string }[];
  modelsLoading: boolean;
  disabled: boolean;
  onProviderChange: (provider: LLMProvider) => void;
  onProfileChange: (profileId: string | null) => void;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
};

export default function StartSessionPicker({
  provider, profileId, model, effort, profiles, modelOptions, effortValues,
  modelsLoading, disabled, onProviderChange, onProfileChange, onModelChange, onEffortChange,
}: StartSessionPickerProps) {
  const { t } = useTranslation('collab');
  const providerProfiles = profiles.filter((profile) => profile.provider === provider);

  return (
    <>
      <div>
        <span className="mb-2 block text-sm font-medium text-foreground">
          {t('startSession.provider', { defaultValue: 'Provider' })}
        </span>
        <div className="flex flex-wrap gap-2">
          {PROVIDER_OPTIONS.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              variant={candidate === provider ? 'default' : 'outline'}
              onClick={() => onProviderChange(candidate)}
              disabled={disabled}
            >
              {PROVIDER_LABELS[candidate]}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="collab-start-profile" className="mb-2 block text-sm font-medium text-foreground">
          {t('startSession.profile', { defaultValue: 'Account profile' })}
        </label>
        <select
          id="collab-start-profile"
          className={FIELD_CLASS}
          value={profileId ?? ''}
          disabled={disabled}
          onChange={(event) => onProfileChange(event.target.value || null)}
        >
          <option value="">
            {t('startSession.profileDefault', { defaultValue: 'Default (no profile)' })}
          </option>
          {providerProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="collab-start-model" className="mb-2 block text-sm font-medium text-foreground">
          {t('startSession.model', { defaultValue: 'Model' })}
        </label>
        <select
          id="collab-start-model"
          className={FIELD_CLASS}
          value={model}
          disabled={disabled || modelsLoading || modelOptions.length === 0}
          onChange={(event) => onModelChange(event.target.value)}
        >
          {modelOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label || option.value}</option>
          ))}
        </select>
      </div>

      {effortValues.length > 0 && (
        <div>
          <label htmlFor="collab-start-effort" className="mb-2 block text-sm font-medium text-foreground">
            {t('startSession.effort', { defaultValue: 'Reasoning effort' })}
          </label>
          <select
            id="collab-start-effort"
            className={FIELD_CLASS}
            value={effort}
            disabled={disabled}
            onChange={(event) => onEffortChange(event.target.value)}
          >
            <option value={DEFAULT_EFFORT_VALUE}>
              {t('startSession.effortDefault', { defaultValue: 'CLI default' })}
            </option>
            {effortValues.map((option) => (
              <option key={option.value} value={option.value}>{option.value}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
