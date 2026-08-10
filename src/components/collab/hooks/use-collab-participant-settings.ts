// What each seat picked in the create form, kept out of the modal so the form
// stays about the form.
//
// Settings are keyed by profile id rather than by position: deselecting a seat
// and picking it again should not silently reset the model the user chose for
// it, and in review mode the two seats swap roles by order alone.

import { useCallback, useState } from 'react';

import { DEFAULT_EFFORT_VALUE } from '../../chat/constants/providerEffort';
import { DEFAULT_PARTICIPANT_SETTINGS, PROVIDER_DEFAULT_MODEL } from '../types';
import type { CollabParticipantSettings, CreateCollaborationParticipant } from '../types';

export function useCollabParticipantSettings() {
  const [settings, setSettings] = useState<Record<string, CollabParticipantSettings>>({});

  const settingsFor = useCallback(
    (profileId: string): CollabParticipantSettings =>
      settings[profileId] ?? DEFAULT_PARTICIPANT_SETTINGS,
    [settings],
  );

  const selectModel = useCallback((profileId: string, model: string) => {
    // The effort goes back to default with the model: the values one model
    // accepts are not the values the next one does, and carrying a stale one
    // over would have the server quietly drop it.
    setSettings((previous) => ({
      ...previous,
      [profileId]: { model, effort: DEFAULT_EFFORT_VALUE },
    }));
  }, []);

  const selectEffort = useCallback((profileId: string, effort: string) => {
    setSettings((previous) => ({
      ...previous,
      [profileId]: { model: previous[profileId]?.model ?? PROVIDER_DEFAULT_MODEL, effort },
    }));
  }, []);

  const reset = useCallback(() => setSettings({}), []);

  return { settingsFor, selectModel, selectEffort, reset };
}

/**
 * Builds one participant for the create payload. Both choices are omitted when
 * they are the default sentinel: an absent key is what tells the server to
 * leave that account on whatever its CLI already uses.
 */
export function toParticipantPayload(
  profileId: string,
  role: string | undefined,
  settings: CollabParticipantSettings,
): CreateCollaborationParticipant {
  const hasModel = settings.model !== PROVIDER_DEFAULT_MODEL;
  return {
    profileId,
    role,
    ...(hasModel ? { model: settings.model } : {}),
    ...(hasModel && settings.effort !== DEFAULT_EFFORT_VALUE ? { effort: settings.effort } : {}),
  };
}
