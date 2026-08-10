// Spending a collaboration is not free: every round bills a request against the
// plan limit of *each* participating account. This states the worst case in
// concrete numbers and points at the usage meter, so the cost is a decision the
// user makes on purpose instead of discovering it when an account runs dry.

import { AlertTriangle, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type CollabCostWarningProps = {
  participantCount: number;
  maxRounds: number;
  /** Opens Settings › Profiles, where the plan-usage meter lives. */
  onOpenProfileSettings?: () => void;
};

export default function CollabCostWarning({
  participantCount,
  maxRounds,
  onOpenProfileSettings,
}: CollabCostWarningProps) {
  const { t } = useTranslation('collab');
  // Worst case: every participant speaks in every round, plus the verdict turn.
  const maxCalls = participantCount * maxRounds + (participantCount > 0 ? 1 : 0);

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {t('cost.title', { defaultValue: 'This consumes the plan limit of every account involved' })}
          </p>
          <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            {t('cost.body', {
              participants: participantCount,
              rounds: maxRounds,
              calls: maxCalls,
              defaultValue: 'Each round sends one request per participant. With {{participants}} account(s) and up to {{rounds}} round(s), this run can spend up to {{calls}} model requests — charged to each account separately, not shared.',
            })}
          </p>
          {onOpenProfileSettings && (
            <button
              type="button"
              onClick={onOpenProfileSettings}
              className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700 dark:text-amber-200 dark:hover:text-amber-100"
            >
              <Gauge className="h-3.5 w-3.5" />
              {t('cost.link', { defaultValue: 'Check remaining usage in Settings › Profiles' })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
