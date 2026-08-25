// The council's computed read of itself, shown once the run ends: what two or
// more participants asserted, what stayed disputed, what worried them, how sure
// they ended up and what it cost.
//
// Every number here was derived from the stored contracts by the server, not
// written by a model, so this view only formats — it never re-groups or
// re-counts. The verdict above it is where the meaning lives; this is the part
// a reader scans in two seconds.

import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../../../shared/view/ui';
import type { CouncilSummary, RiskSeverity } from '../../council-types';

const SEVERITY_STYLES: Record<RiskSeverity, string> = {
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      <ul className="mt-1 space-y-1">{children}</ul>
    </div>
  );
}

function Entry({ children }: { children: React.ReactNode }) {
  return <li className="text-xs leading-relaxed text-foreground/90">{children}</li>;
}

/** "12,400 of 200,000 tokens · 7 of 13 turns", plus why it stopped when it did. */
function BudgetLine({ budget }: { budget: CouncilSummary['budget'] }) {
  const { t } = useTranslation('collab');
  const format = (value: number) => value.toLocaleString();

  return (
    <p className="text-[11px] text-muted-foreground">
      {t('summary.budgetUsage', {
        tokensUsed: format(budget.tokensUsed),
        totalTokens: format(budget.totalTokens),
        turnsUsed: budget.turnsUsed,
        maxTurns: budget.maxTurns,
        defaultValue:
          '{{tokensUsed}} of {{totalTokens}} tokens · {{turnsUsed}} of {{maxTurns}} turns',
      })}
      {budget.stoppedBy && (
        <span className="ml-1 text-amber-700 dark:text-amber-400">
          {budget.stoppedBy === 'tokens'
            ? t('summary.stoppedByTokens', { defaultValue: '— stopped on the token budget' })
            : t('summary.stoppedByTurns', { defaultValue: '— stopped on the turn budget' })}
        </span>
      )}
    </p>
  );
}

export default function CollabCouncilSummary({ summary }: { summary: CouncilSummary }) {
  const { t } = useTranslation('collab');

  // The summary is a stored JSON blob, so a row written by an older build can
  // legitimately arrive with lists missing rather than empty.
  const agreements = summary.agreements ?? [];
  const disputes = summary.disputes ?? [];
  const risks = summary.risks ?? [];
  const { confidence, budget } = summary;

  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ListChecks className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <h4 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          {t('summary.title', { defaultValue: 'Council summary' })}
        </h4>
        {confidence && (
          <Badge variant="outline" className="text-[10px]">
            {t('summary.confidence', {
              min: confidence.min,
              median: confidence.median,
              max: confidence.max,
              defaultValue: 'confidence {{min}}–{{max}}%, median {{median}}%',
            })}
          </Badge>
        )}
        {summary.contractsFailed > 0 && (
          <Badge
            variant="secondary"
            className="bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          >
            {t('summary.contractsFailed', {
              count: summary.contractsFailed,
              defaultValue: '{{count}} incomplete contract(s)',
            })}
          </Badge>
        )}
      </div>

      <div className="space-y-3">
        {agreements.length > 0 && (
          <Section title={t('summary.agreements', { defaultValue: 'Agreed' })}>
            {agreements.map((item, index) => (
              <Entry key={`agreement-${index}`}>
                {item.point}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  ({item.agreedBy.length})
                </span>
              </Entry>
            ))}
          </Section>
        )}

        {disputes.length > 0 && (
          <Section title={t('summary.disputes', { defaultValue: 'Still disputed' })}>
            {disputes.map((item, index) => (
              <Entry key={`dispute-${index}`}>
                {item.point}
                {item.against.length > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    ({item.against.join(', ')})
                  </span>
                )}
              </Entry>
            ))}
          </Section>
        )}

        {risks.length > 0 && (
          <Section title={t('summary.risks', { defaultValue: 'Risks' })}>
            {risks.map((item, index) => (
              <Entry key={`risk-${index}`}>
                <Badge
                  variant="secondary"
                  className={`mr-1.5 align-middle text-[10px] capitalize ${SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.medium}`}
                >
                  {item.severity}
                </Badge>
                {item.risk}
              </Entry>
            ))}
          </Section>
        )}

        {agreements.length === 0 && disputes.length === 0 && risks.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t('summary.empty', {
              defaultValue: 'No participant stated a contract this run could aggregate.',
            })}
          </p>
        )}

        <BudgetLine budget={budget} />
      </div>
    </div>
  );
}
