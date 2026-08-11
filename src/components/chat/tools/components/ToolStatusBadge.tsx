import { cn } from '../../../../lib/utils';

export type ToolStatus = 'running' | 'completed' | 'error' | 'denied';

const STATUS_CONFIG: Record<ToolStatus, { label: string; className: string }> = {
  running: {
    label: 'Running',
    className: 'border border-[var(--accent-line)] bg-[var(--accent-tint)] text-primary',
  },
  completed: {
    label: 'Completed',
    className: 'border border-[var(--success-line)] bg-[var(--success-tint)] text-success',
  },
  error: {
    label: 'Error',
    className: 'border border-[var(--danger-line)] bg-[var(--danger-tint)] text-danger',
  },
  denied: {
    label: 'Denied',
    className: 'border border-[var(--warning-line)] bg-[var(--warning-tint)] text-warning',
  },
};

interface ToolStatusBadgeProps {
  status: ToolStatus;
  className?: string;
}

export function ToolStatusBadge({ status, className }: ToolStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-ctl px-1.5 py-px text-[10px] font-medium',
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
