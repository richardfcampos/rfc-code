import { useMemo } from 'react';
import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useProfiles } from '../../profiles/hooks/useProfiles';
import { useTeamView } from '../hooks/useTeamView';
import { computeTeamViewLayout } from '../utils/teamViewLayout';

import TeamViewEdgesLayer from './TeamViewEdgesLayer';
import TeamViewNodeCard from './TeamViewNodeCard';

type TeamViewTabProps = {
  onNavigateToSession: (sessionId: string) => void;
};

/**
 * Read-only tab (R16): a live graph of currently running agent sessions
 * (nodes) and the handoff messages between them (edges). Click a node to jump
 * to that session's chat — this view has no mutation path of its own (C2:
 * Team View is a canvas over orchestration data, never a workspace).
 */
export default function TeamViewTab({ onNavigateToSession }: TeamViewTabProps) {
  const { t } = useTranslation();
  const { snapshot, isLoading, loadError } = useTeamView();
  const { profiles } = useProfiles();

  const profileNameById = useMemo(() => {
    const map = new Map<string, string>();
    profiles.forEach((profile) => map.set(profile.id, profile.name));
    return map;
  }, [profiles]);

  const layout = useMemo(
    () => computeTeamViewLayout(snapshot.sessions, snapshot.edges),
    [snapshot],
  );

  const isEmpty = !isLoading && snapshot.sessions.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-foreground">
          {t('tabs.team', { defaultValue: 'Team View' })}
        </span>
        <span className="text-xs text-muted-foreground">
          {snapshot.sessions.length === 1
            ? '1 active session'
            : `${snapshot.sessions.length} active sessions`}
        </span>
      </div>

      {loadError && (
        <div className="flex-shrink-0 border-b border-border bg-danger/10 px-3 py-2 text-sm text-danger">
          Failed to load the team view. It will retry automatically.
        </div>
      )}

      {isEmpty ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <Network className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No agent sessions are running right now.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="relative" style={{ width: layout.width, height: layout.height }}>
            <TeamViewEdgesLayer edges={layout.edges} width={layout.width} height={layout.height} />
            {layout.nodes.map(({ session, x, y }) => (
              <TeamViewNodeCard
                key={session.sessionId}
                session={session}
                x={x}
                y={y}
                profileName={session.profileId ? profileNameById.get(session.profileId) ?? null : null}
                onOpen={onNavigateToSession}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
