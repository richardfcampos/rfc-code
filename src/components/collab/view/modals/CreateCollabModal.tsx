// Start screen for a collaboration: what to discuss, which mode, which accounts
// speak and for how many rounds. Every choice maps 1:1 to the create payload,
// and the cost warning is part of the form — not a footnote — because each
// round bills every participating account.

import { useState } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';
import { useCollabModelCatalog } from '../../hooks/use-collab-model-catalog';
import {
  toParticipantPayload,
  useCollabParticipantSettings,
} from '../../hooks/use-collab-participant-settings';
import { useCollabSeatSelection } from '../../hooks/use-collab-seat-selection';
import { useClaudeProfiles } from '../../hooks/useCollaborations';
import { MIN_PARTICIPANTS, type CreateCollaborationInput } from '../../types';

import CollabCostWarning from './CollabCostWarning';
import CollabParticipantPicker from './CollabParticipantPicker';
import CollabRunOptions from './CollabRunOptions';
import CollabTopicField from './CollabTopicField';

type CreateCollabModalProps = {
  isOpen: boolean;
  projectPath: string;
  onClose: () => void;
  onSubmit: (input: CreateCollaborationInput) => Promise<unknown>;
  /** Opens Settings › Profiles so the user can check remaining plan usage. */
  onOpenProfileSettings?: () => void;
};

export default function CreateCollabModal({
  isOpen, projectPath, onClose, onSubmit, onOpenProfileSettings,
}: CreateCollabModalProps) {
  const { t } = useTranslation('collab');
  const { profiles, error: profilesError } = useClaudeProfiles(isOpen);
  // Catalogs are fetched for every provider on offer, not just the seats picked
  // so far: the menu has to be populated the moment a row is selected.
  const models = useCollabModelCatalog(isOpen, profiles.map((profile) => profile.provider));
  const { settingsFor, selectModel, selectEffort, reset: resetSettings } =
    useCollabParticipantSettings();
  const {
    mode, selectedIds, maxRounds, selectionCap,
    changeMode, toggleProfile, roleFor, setMaxRounds, reset: resetSeats,
  } = useCollabSeatSelection();
  const [topic, setTopic] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Skill suggestions come from the seated Claude accounts only: each profile
  // discovers skills under its own config dir, and Codex neither shares the `/`
  // syntax nor has verified skill loading outside its interactive CLI.
  const claudeSeatIds = profiles
    .filter((profile) => profile.provider === 'claude' && selectedIds.includes(profile.id))
    .map((profile) => profile.id);

  if (!isOpen) {
    return null;
  }

  const resetAndClose = () => {
    setTopic('');
    resetSeats();
    resetSettings();
    setError(null);
    onClose();
  };

  const validate = (trimmedTopic: string): string | null => {
    if (!trimmedTopic) {
      return t('form.topicRequired', { defaultValue: 'Describe what the accounts should discuss.' });
    }
    if (selectedIds.length < MIN_PARTICIPANTS) {
      return t('form.participantsRequired', {
        min: MIN_PARTICIPANTS,
        defaultValue: 'Pick at least {{min}} authenticated Claude or Codex profiles.',
      });
    }
    if (mode === 'review' && selectedIds.length !== MIN_PARTICIPANTS) {
      return t('form.reviewNeedsTwo', { defaultValue: 'Review mode runs with exactly two accounts.' });
    }
    return null;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTopic = topic.trim();
    const validationError = validate(trimmedTopic);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        topic: trimmedTopic,
        projectPath,
        mode,
        participants: selectedIds.map((profileId) =>
          toParticipantPayload(profileId, roleFor(profileId), settingsFor(profileId))),
        maxRounds,
      });
      resetAndClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to start collaboration');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-lg border border-border bg-background">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border p-4">
          <h3 className="text-lg font-medium text-foreground">
            {t('form.title', { defaultValue: 'New collaboration' })}
          </h3>
          <Button variant="ghost" size="sm" onClick={resetAndClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <CollabTopicField
            value={topic}
            onChange={setTopic}
            projectPath={projectPath}
            claudeProfileIds={claudeSeatIds}
          />

          <CollabRunOptions
            mode={mode}
            maxRounds={maxRounds}
            onModeChange={changeMode}
            onMaxRoundsChange={setMaxRounds}
          />

          <CollabParticipantPicker
            profiles={profiles}
            selectedIds={selectedIds}
            selectionCap={selectionCap}
            loadError={profilesError}
            roleFor={roleFor}
            onToggle={toggleProfile}
            models={models}
            settingsFor={settingsFor}
            onSelectModel={selectModel}
            onSelectEffort={selectEffort}
          />

          <CollabCostWarning
            participantCount={selectedIds.length}
            maxRounds={maxRounds}
            onOpenProfileSettings={onOpenProfileSettings}
          />

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={resetAndClose}>
              {t('form.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('form.submit', { defaultValue: 'Start collaboration' })}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
