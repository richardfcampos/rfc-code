// The structured half of a council turn: what the answer rests on, what it
// accepts as risk, what would settle it, where it disputes the others, and how
// sure its author is.
//
// It is rendered *under* the prose, never instead of it — the contract is
// parsed best-effort, so a turn that stated half of it shows the half it
// stated, and a turn that stated none of it shows nothing here at all while its
// raw answer stays exactly as it always rendered.

import { ClipboardList } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../../../shared/view/ui';
import type { CouncilContract, RiskSeverity } from '../../council-types';

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

export default function CollabTurnContract({
  contract,
  contractError,
}: {
  contract: CouncilContract;
  contractError: string | null;
}) {
  const { t } = useTranslation('collab');

  // The server parses these lists leniently and stores whatever survived, so a
  // stored contract can legitimately arrive with fields missing.
  const evidence = contract.evidence ?? [];
  const risks = contract.risks ?? [];
  const tests = contract.tests ?? [];
  const disagreements = contract.disagreements ?? [];
  const { confidence } = contract;

  const isEmpty =
    evidence.length === 0 &&
    risks.length === 0 &&
    tests.length === 0 &&
    disagreements.length === 0 &&
    !confidence;

  // Nothing was understood: the prose above is the whole answer, and an empty
  // frame would only suggest the turn said less than it did.
  if (isEmpty) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2.5 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardList className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('contract.title', { defaultValue: 'Contract' })}
        </span>
        {confidence && (
          <Badge variant="outline" className="text-[10px]">
            {t('contract.confidence', {
              value: confidence.value,
              defaultValue: '{{value}}% confident',
            })}
          </Badge>
        )}
      </div>

      {evidence.length > 0 && (
        <Section title={t('contract.evidence', { defaultValue: 'Evidence' })}>
          {evidence.map((item, index) => (
            <Entry key={`evidence-${index}`}>
              {item.observation}
              {item.source && (
                <span className="ml-1 break-all font-mono text-[10px] text-muted-foreground">
                  {item.source}
                </span>
              )}
            </Entry>
          ))}
        </Section>
      )}

      {risks.length > 0 && (
        <Section title={t('contract.risks', { defaultValue: 'Risks' })}>
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

      {tests.length > 0 && (
        <Section title={t('contract.tests', { defaultValue: 'Tests' })}>
          {tests.map((item, index) => (
            <Entry key={`test-${index}`}>
              <Badge variant="outline" className="mr-1.5 align-middle text-[10px] capitalize">
                {item.status}
              </Badge>
              {item.test}
              {item.result && (
                <span className="ml-1 text-muted-foreground">— {item.result}</span>
              )}
            </Entry>
          ))}
        </Section>
      )}

      {disagreements.length > 0 && (
        <Section title={t('contract.disagreements', { defaultValue: 'Disagreements' })}>
          {disagreements.map((item, index) => (
            <Entry key={`disagreement-${index}`}>
              <span className="font-medium text-foreground">{item.with}:</span> {item.point}
            </Entry>
          ))}
        </Section>
      )}

      {confidence?.rationale && (
        <p className="text-xs italic leading-relaxed text-muted-foreground">
          {confidence.rationale}
        </p>
      )}

      {/* A partial contract is still worth showing; this says which part is missing. */}
      {contractError && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400">{contractError}</p>
      )}
    </div>
  );
}
