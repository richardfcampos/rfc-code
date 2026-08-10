// Who sits at the table, in what order, and how many rounds they get.
//
// Order is the whole reason this is state and not a set: in review mode the
// first pick authors and the second reviews, and the first participant is also
// the arbiter that writes the verdict. The mode constrains both the seat count
// and the round ceiling, so the three move together and live here rather than
// as three independent pieces of state the form has to keep consistent.

import { useCallback, useState } from 'react';

import { DEFAULT_MAX_ROUNDS, MAX_PARTICIPANTS, MIN_PARTICIPANTS } from '../types';
import type { CollabMode } from '../types';

export function useCollabSeatSelection() {
  const [mode, setMode] = useState<CollabMode>('debate');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [maxRounds, setMaxRounds] = useState(DEFAULT_MAX_ROUNDS);

  const selectionCap = mode === 'review' ? MIN_PARTICIPANTS : MAX_PARTICIPANTS;

  const changeMode = useCallback((next: CollabMode) => {
    setMode(next);
    // `review` is a two-account format, and `vote` is single-round by design.
    setSelectedIds((previous) => (next === 'review' ? previous.slice(0, MIN_PARTICIPANTS) : previous));
    setMaxRounds((previous) => (next === 'vote' ? 1 : previous));
  }, []);

  const toggleProfile = useCallback((profileId: string) => {
    setSelectedIds((previous) => {
      if (previous.includes(profileId)) {
        return previous.filter((id) => id !== profileId);
      }
      return previous.length >= selectionCap ? previous : [...previous, profileId];
    });
  }, [selectionCap]);

  /** Only review assigns roles; the other modes leave every seat a participant. */
  const roleFor = useCallback((profileId: string): string | undefined => {
    if (mode !== 'review') {
      return undefined;
    }
    return selectedIds.indexOf(profileId) === 0 ? 'author' : 'reviewer';
  }, [mode, selectedIds]);

  const reset = useCallback(() => {
    setMode('debate');
    setSelectedIds([]);
    setMaxRounds(DEFAULT_MAX_ROUNDS);
  }, []);

  return {
    mode, selectedIds, maxRounds, selectionCap,
    changeMode, toggleProfile, roleFor, setMaxRounds, reset,
  };
}
