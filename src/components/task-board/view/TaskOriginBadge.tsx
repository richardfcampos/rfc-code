// One place that decides how each task origin looks, so cards never disagree
// about what "agent" or "automation" means — mirrors CollabStatusBadge.

import { useTranslation } from 'react-i18next';

import { Badge } from '../../../shared/view/ui';
import type { TaskOrigin } from '../types';

const ORIGIN_STYLES: Record<TaskOrigin, string> = {
  user: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  agent: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  automation: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

const ORIGIN_LABELS: Record<TaskOrigin, string> = {
  user: 'You',
  agent: 'Agent',
  automation: 'Automation',
};

export default function TaskOriginBadge({ origin }: { origin: TaskOrigin }) {
  const { t } = useTranslation('taskBoard');

  return (
    <Badge variant="secondary" className={`text-[10px] ${ORIGIN_STYLES[origin]}`}>
      {t(`origin.${origin}`, { defaultValue: ORIGIN_LABELS[origin] })}
    </Badge>
  );
}
