// A single turn: who spoke, in which role, whether they signalled agreement,
// and the answer itself rendered with the same markdown pipeline as chat.
// The arbiter turn is styled apart because it is the verdict, not an opinion.

import { Check, Gavel, Minus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../../../shared/view/ui';
import { Markdown } from '../../../chat/view/subcomponents/Markdown';
import type { CollaborationTurn } from '../../types';

function ConsensusBadge({ consensus }: { consensus: boolean | null }) {
  const { t } = useTranslation('collab');

  if (consensus === true) {
    return (
      <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
        <Check className="h-3 w-3" />
        {t('consensus.agreed', { defaultValue: 'Agreed' })}
      </Badge>
    );
  }

  if (consensus === false) {
    return (
      <Badge variant="secondary" className="gap-1 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
        <X className="h-3 w-3" />
        {t('consensus.blocked', { defaultValue: 'Blocked' })}
      </Badge>
    );
  }

  // No parsable signal: the model ignored the required last line. Shown as its
  // own state so it is never mistaken for an explicit disagreement.
  return (
    <Badge variant="secondary" className="gap-1 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
      <Minus className="h-3 w-3" />
      {t('consensus.none', { defaultValue: 'No signal' })}
    </Badge>
  );
}

export default function CollabTurnCard({ turn }: { turn: CollaborationTurn }) {
  const { t } = useTranslation('collab');
  const isArbiter = turn.role === 'arbiter';

  return (
    <div
      className={`rounded-lg border p-3 ${
        isArbiter
          ? 'border-purple-300 bg-purple-50/60 dark:border-purple-700/60 dark:bg-purple-900/20'
          : 'border-border bg-card/50'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {isArbiter && <Gavel className="h-4 w-4 flex-shrink-0 text-purple-500" />}
        <span className="truncate text-sm font-medium text-foreground">{turn.profileName}</span>
        <Badge variant="outline" className="text-[10px] capitalize">
          {isArbiter
            ? t('turn.roleArbiter', { defaultValue: 'arbiter' })
            : t('turn.roleParticipant', { defaultValue: 'participant' })}
        </Badge>
        {!isArbiter && <ConsensusBadge consensus={turn.consensus} />}
      </div>

      {turn.error && (
        <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
          {turn.error}
        </div>
      )}

      <Markdown className="prose prose-sm max-w-none font-serif dark:prose-invert">
        {turn.content}
      </Markdown>
    </div>
  );
}
