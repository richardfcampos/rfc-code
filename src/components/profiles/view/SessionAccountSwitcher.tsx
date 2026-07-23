import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import { createPortal } from 'react-dom';

import { authenticatedFetch } from '../../../utils/api';
import { Button } from '../../../shared/view/ui';
import type { LLMProvider } from '../../../types/app';
import type { Profile } from '../types';
import { useSessionHandoff, type HandoffResult } from '../hooks/useSessionHandoff';

type SessionAccountSwitcherProps = {
  sessionId?: string;
  provider?: LLMProvider | string;
  currentProfileId?: string | null;
};

function describeOutcome(result: HandoffResult): string {
  switch (result.status) {
    case 'queued':
      return 'A turn is running — the switch will apply when it finishes.';
    case 'seeded':
      return 'This provider cannot move a live session, so a new session was started with the prior context.';
    case 'transplanted':
    default:
      return 'Account switched. The next turn continues on the new account.';
  }
}

/**
 * Header action that hands the current session to another account of the same
 * provider (HUB-12). Lists the sibling profiles and posts the handoff; the
 * resolved status (switched / queued / seeded) is surfaced inline.
 */
export default function SessionAccountSwitcher({
  sessionId,
  provider,
  currentProfileId,
}: SessionAccountSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [candidates, setCandidates] = useState<Profile[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { switchAccount, isSwitching, error, result, reset } = useSessionHandoff();

  const loadCandidates = useCallback(async () => {
    if (!provider) {
      return;
    }
    setLoadError(null);
    try {
      const response = await authenticatedFetch(
        `/api/profiles?provider=${encodeURIComponent(provider)}`,
      );
      const body = await response.json();
      if (!response.ok || !body?.success) {
        throw new Error('Failed to load accounts');
      }
      const profiles = (body.data?.profiles as Profile[] | undefined) ?? [];
      setCandidates(profiles.filter((profile) => profile.id !== currentProfileId));
    } catch (loadingError) {
      setLoadError(loadingError instanceof Error ? loadingError.message : 'Failed to load accounts');
    }
  }, [provider, currentProfileId]);

  useEffect(() => {
    if (isOpen) {
      void loadCandidates();
    }
  }, [isOpen, loadCandidates]);

  if (!sessionId || !provider) {
    return null;
  }

  const close = () => {
    setIsOpen(false);
    reset();
  };

  const onSwitch = async (profileId: string) => {
    try {
      await switchAccount(sessionId, profileId);
    } catch {
      // error is surfaced via the hook's `error` state; keep the modal open.
    }
  };

  return (
    <>
      <button
        type="button"
        title="Switch account"
        aria-label="Switch account"
        onClick={() => setIsOpen(true)}
        className="ml-1 inline-flex flex-shrink-0 items-center rounded-full border border-border/60 bg-muted/40 p-1 text-muted-foreground transition-colors hover:bg-muted"
      >
        <ArrowLeftRight className="h-3 w-3" />
      </button>

      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-lg border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h3 className="text-lg font-medium text-foreground">Switch account</h3>
                <Button variant="ghost" size="sm" onClick={close}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-3 p-4">
                {result ? (
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                    {describeOutcome(result)}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Continue this session on a different {String(provider)} account.
                  </p>
                )}

                {loadError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
                    {loadError}
                  </div>
                )}
                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
                    {error}
                  </div>
                )}

                {!result && candidates.length === 0 && !loadError && (
                  <p className="text-sm text-muted-foreground">
                    No other accounts for this provider yet.
                  </p>
                )}

                {!result && candidates.length > 0 && (
                  <ul className="space-y-2">
                    {candidates.map((candidate) => (
                      <li key={candidate.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-foreground" title={candidate.name}>
                          {candidate.name}
                        </span>
                        <Button size="sm" disabled={isSwitching} onClick={() => onSwitch(candidate.id)}>
                          {isSwitching ? 'Switching…' : 'Switch'}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex justify-end">
                  <Button variant="ghost" onClick={close}>
                    {result ? 'Done' : 'Cancel'}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
