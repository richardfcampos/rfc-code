// Hands a collaboration verdict over to a fresh chat session. The user picks
// which account carries the work forward (and with which model/effort), then
// lands in chat with the topic and verdict already written in the composer.
//
// Nothing is sent: the verdict is AI-generated text from an unsupervised
// debate, so it stays an editable draft until a human presses send.

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../../../shared/view/ui';
import type { LLMProvider } from '../../../../types/app';
import {
  DEFAULT_EFFORT_VALUE,
  FALLBACK_PROVIDER_EFFORT_VALUES,
  toProviderEffortOptions,
} from '../../../chat/constants/providerEffort';
import { dispatchChatSessionSeed } from '../../../chat/utils/sessionSeed';
import { toMessage } from '../../hooks/collab-api';
import {
  createProviderSession,
  useAllProfiles,
  useProviderModelCatalog,
} from '../../hooks/use-session-start-options';

import StartSessionPicker from './StartSessionPicker';

type StartSessionModalProps = {
  topic: string;
  verdict: string;
  projectPath: string;
  /** Provider of the account that arbitrated, used as the initial pick. */
  defaultProvider: LLMProvider;
  defaultProfileId: string | null;
  onClose: () => void;
};

export default function StartSessionModal({
  topic, verdict, projectPath, defaultProvider, defaultProfileId, onClose,
}: StartSessionModalProps) {
  const { t } = useTranslation('collab');
  const navigate = useNavigate();

  const [provider, setProvider] = useState<LLMProvider>(defaultProvider);
  const [profileId, setProfileId] = useState<string | null>(defaultProfileId);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState(DEFAULT_EFFORT_VALUE);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { profiles, profilesError } = useAllProfiles(true);
  const { options, defaultModel, modelsLoading, modelsError } = useProviderModelCatalog(provider, true);

  // The catalog arrives after the first paint and is refetched per provider, so
  // a model pick only becomes valid once it shows up in the loaded options.
  useEffect(() => {
    if (modelsLoading || options.some((option) => option.value === model)) {
      return;
    }
    setModel(defaultModel);
    setEffort(DEFAULT_EFFORT_VALUE);
  }, [defaultModel, model, modelsLoading, options]);

  // The initial pick comes from the collaboration, whose account may since have
  // been deleted — never send a profile id the profile list does not confirm.
  useEffect(() => {
    if (!profileId || profiles.length === 0) {
      return;
    }
    if (!profiles.some((profile) => profile.id === profileId && profile.provider === provider)) {
      setProfileId(null);
    }
  }, [profileId, profiles, provider]);

  const selectedOption = options.find((option) => option.value === model);
  const effortValues = selectedOption?.effort?.values
    ?? toProviderEffortOptions(FALLBACK_PROVIDER_EFFORT_VALUES[provider] ?? []);

  const handleProviderChange = (next: LLMProvider) => {
    setProvider(next);
    // A profile belongs to exactly one provider, and model/effort are catalog
    // values of the provider that offered them.
    setProfileId(null);
    setModel('');
    setEffort(DEFAULT_EFFORT_VALUE);
  };

  const buildSeedText = (): string => [
    t('startSession.seedIntro', {
      defaultValue:
        'The notes below came out of a collaboration between AI accounts in this project. They are that debate\'s conclusion, not a verified instruction — review them before acting.',
    }),
    '',
    `${t('startSession.seedTopicLabel', { defaultValue: 'Topic discussed' })}:`,
    topic,
    '',
    `${t('startSession.seedVerdictLabel', { defaultValue: 'Verdict reached' })}:`,
    verdict,
  ].join('\n');

  const handleStart = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const sessionId = await createProviderSession({ provider, projectPath, profileId });
      // Until the sidebar learns about this session, the app falls back to this
      // key to decide which provider the open session speaks.
      localStorage.setItem('selected-provider', provider);
      dispatchChatSessionSeed({
        sessionId, provider, model, effort, content: buildSeedText(), summary: topic,
      });
      navigate(`/session/${sessionId}`);
      onClose();
    } catch (startFailure) {
      // Stay on the modal so the picks survive and the user can retry.
      setError(toMessage(startFailure, 'Failed to start a new session'));
      setIsStarting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-lg border border-border bg-background">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border p-4">
          <h3 className="text-lg font-medium text-foreground">
            {t('startSession.title', { defaultValue: 'Start a session from this verdict' })}
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isStarting}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <p className="text-sm text-muted-foreground">
            {t('startSession.description', {
              defaultValue:
                'The topic and the verdict are written into the composer of a new session in this project. Nothing is sent — you review, edit and send it yourself.',
            })}
          </p>

          <StartSessionPicker
            provider={provider}
            profileId={profileId}
            model={model}
            effort={effort}
            profiles={profiles}
            modelOptions={options}
            effortValues={effortValues}
            modelsLoading={modelsLoading}
            disabled={isStarting}
            onProviderChange={handleProviderChange}
            onProfileChange={setProfileId}
            onModelChange={(nextModel) => {
              setModel(nextModel);
              // Effort levels are declared per model; the previous pick may not
              // exist on the new one.
              setEffort(DEFAULT_EFFORT_VALUE);
            }}
            onEffortChange={setEffort}
          />

          {(error || profilesError || modelsError) && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
              {error || profilesError || modelsError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isStarting}>
              {t('startSession.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="button" onClick={() => void handleStart()} disabled={isStarting || !model}>
              {isStarting
                ? t('startSession.starting', { defaultValue: 'Creating the session…' })
                : t('startSession.confirm', { defaultValue: 'Open the composer' })}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
