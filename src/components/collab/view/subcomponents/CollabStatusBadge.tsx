// One place that decides how each collaboration status looks, so the list and
// the detail view can never disagree about what "exhausted" or "failed" means.

import { useTranslation } from 'react-i18next';

import { Badge } from '../../../../shared/view/ui';
import type { CollabStatus } from '../../types';

const STATUS_STYLES: Record<CollabStatus, string> = {
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  converged: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  exhausted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  stopped: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_LABELS: Record<CollabStatus, string> = {
  running: 'Running',
  converged: 'Agreed',
  exhausted: 'Out of rounds',
  stopped: 'Stopped',
  failed: 'Failed',
};

export default function CollabStatusBadge({ status }: { status: CollabStatus }) {
  const { t } = useTranslation('collab');

  return (
    <Badge variant="secondary" className={STATUS_STYLES[status]}>
      {t(`status.${status}`, { defaultValue: STATUS_LABELS[status] })}
    </Badge>
  );
}
