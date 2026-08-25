// Live transcript of one collaboration: the verdict first (it is what the user
// came for), then every turn in order, grouped by round. Reads through the
// polling hook, which keeps refreshing only while the run is still going.

import { useState } from 'react';
import { ArrowLeft, Gavel, MessageSquarePlus, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '../../../shared/view/ui';
import { Markdown } from '../../chat/view/subcomponents/Markdown';
import { useCollaborationDetail } from '../hooks/useCollaborations';
import type { CollaborationTurn } from '../types';

import StartSessionModal from './modals/StartSessionModal';
import CollabCouncilSummary from './subcomponents/CollabCouncilSummary';
import CollabStatusBadge from './subcomponents/CollabStatusBadge';
import CollabTurnCard from './subcomponents/CollabTurnCard';

type CollabDetailProps = {
  collaborationId: string;
  onBack: () => void;
};

/** Groups turns into ordered rounds, tolerating gaps in the round numbering. */
function groupByRound(turns: CollaborationTurn[]): { round: number; turns: CollaborationTurn[] }[] {
  const rounds = new Map<number, CollaborationTurn[]>();
  [...turns]
    .sort((a, b) => (a.round - b.round) || (a.turnIndex - b.turnIndex))
    .forEach((turn) => {
      const bucket = rounds.get(turn.round) ?? [];
      bucket.push(turn);
      rounds.set(turn.round, bucket);
    });

  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, roundTurns]) => ({ round, turns: roundTurns }));
}

export default function CollabDetail({ collaborationId, onBack }: CollabDetailProps) {
  const { t } = useTranslation('collab');
  const { collaboration, isLoading, loadError, isStopping, stop } = useCollaborationDetail(collaborationId);
  const [isStartSessionOpen, setIsStartSessionOpen] = useState(false);
  // The arbiter is the first participant, so its account is the natural
  // starting pick for the session that carries the verdict forward.
  const arbiter = collaboration?.participants[0] ?? null;

  // The arbiter turn holds the same text as `verdict`; when the verdict block is
  // already showing it, repeating it in the transcript is just noise.
  const visibleTurns = (collaboration?.turns ?? []).filter(
    (turn) => !(collaboration?.verdict && turn.role === 'arbiter'),
  );
  const rounds = groupByRound(visibleTurns);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b border-border p-3 sm:p-4">
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-medium text-foreground">
              {collaboration?.topic ?? t('detail.loading', { defaultValue: 'Loading collaboration…' })}
            </h3>
            {collaboration && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <CollabStatusBadge status={collaboration.status} />
                <Badge variant="outline" className="text-[10px] capitalize">{collaboration.mode}</Badge>
                <span className="text-xs text-muted-foreground">
                  {t('detail.roundProgress', {
                    current: collaboration.currentRound,
                    max: collaboration.maxRounds,
                    defaultValue: 'Round {{current}} of {{max}}',
                  })}
                </span>
              </div>
            )}
          </div>
          {collaboration?.status === 'running' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void stop()}
              disabled={isStopping}
              className="flex-shrink-0 text-red-600 hover:text-red-700"
            >
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {t('detail.stop', { defaultValue: 'Stop' })}
            </Button>
          )}
        </div>

        {collaboration && collaboration.participants.length > 0 && (
          <p className="mt-2 truncate text-xs text-muted-foreground">
            {collaboration.participants.map((participant) => participant.profileName).join(' · ')}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
        {isLoading && (
          <p className="py-8 text-center text-muted-foreground">
            {t('detail.loading', { defaultValue: 'Loading collaboration…' })}
          </p>
        )}

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
            {loadError}
          </div>
        )}

        {collaboration?.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
            {collaboration.error}
          </div>
        )}

        {collaboration?.verdict && (
          <div className="rounded-lg border-2 border-purple-400 bg-purple-50/70 p-4 shadow-sm dark:border-purple-600 dark:bg-purple-900/25">
            <div className="mb-2 flex items-center gap-2">
              <Gavel className="h-4 w-4 flex-shrink-0 text-purple-600 dark:text-purple-400" />
              <h4 className="text-sm font-semibold uppercase tracking-wide text-purple-800 dark:text-purple-200">
                {t('detail.verdict', { defaultValue: 'Verdict' })}
              </h4>
            </div>
            <Markdown className="prose prose-sm max-w-none font-serif dark:prose-invert">
              {collaboration.verdict}
            </Markdown>

            <Button
              variant="outline"
              onClick={() => setIsStartSessionOpen(true)}
              className="mt-3 w-full sm:w-auto"
            >
              <MessageSquarePlus className="mr-2 h-4 w-4" />
              {t('startSession.action', { defaultValue: 'Start a session from this verdict' })}
            </Button>
          </div>
        )}

        {/* Council runs only, and only once they end: the summary is computed
            from the stored contracts when the round loop closes. */}
        {collaboration?.summary && <CollabCouncilSummary summary={collaboration.summary} />}

        {rounds.map(({ round, turns }) => (
          <div key={round} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('detail.round', { round, defaultValue: 'Round {{round}}' })}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            {turns.map((turn) => <CollabTurnCard key={turn.id} turn={turn} />)}
          </div>
        ))}

        {collaboration && rounds.length === 0 && !collaboration.verdict && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {collaboration.status === 'running'
              ? t('detail.waiting', { defaultValue: 'Waiting for the first turn…' })
              : t('detail.noTurns', { defaultValue: 'This collaboration produced no turns.' })}
          </p>
        )}
      </div>

      {/* Mounted only while open so every open starts from the current defaults. */}
      {isStartSessionOpen && collaboration?.verdict && (
        <StartSessionModal
          topic={collaboration.topic}
          verdict={collaboration.verdict}
          projectPath={collaboration.projectPath}
          defaultProvider={arbiter?.provider ?? 'claude'}
          defaultProfileId={arbiter?.profileId ?? null}
          onClose={() => setIsStartSessionOpen(false)}
        />
      )}
    </div>
  );
}
