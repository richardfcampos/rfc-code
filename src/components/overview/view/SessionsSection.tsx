import type { OverviewSession } from '../utils/overview-data';

import SessionCard from './SessionCard';

type SessionsSectionProps = {
  sessions: OverviewSession[];
};

export default function SessionsSection({ sessions }: SessionsSectionProps) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        No recent sessions
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 gap-3 min-[900px]:[grid-template-columns:repeat(auto-fill,minmax(330px,1fr))]"
    >
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  );
}
