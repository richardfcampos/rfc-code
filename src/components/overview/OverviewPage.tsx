import { useMemo } from 'react';

import { useOverviewData } from './useOverviewData';
import { useOverviewFilters } from './useOverviewFilters';
import {
  filterOverviewSessions,
  filterOverviewTasks,
  isOverviewFilterId,
  litBoardColumns,
} from './utils/overview-filter';
import FilterChips, { type FilterChipOption } from './view/FilterChips';
import BoardsSection from './view/BoardsSection';
import SessionsSection from './view/SessionsSection';
import TasksSection from './view/TasksSection';

function SectionTitle({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline gap-2.5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
      <span className="text-xs text-faint">{caption}</span>
    </div>
  );
}

export default function OverviewPage() {
  const { sessions, tasks, boards, counts, isLoading } = useOverviewData();
  const { active, toggle, selectAll } = useOverviewFilters();

  const visibleSessions = useMemo(() => filterOverviewSessions(sessions, active), [sessions, active]);
  const visibleTasks = useMemo(() => filterOverviewTasks(tasks, active), [tasks, active]);
  const dimmedColumns = useMemo(() => litBoardColumns(active), [active]);

  // Hardcoded English copy for now; can move to useTranslation('overview')
  // without reshaping the render below.
  const chipOptions: FilterChipOption[] = [
    { id: 'run', label: 'running', count: counts.running, dotClassName: 'bg-primary' },
    { id: 'attn', label: 'needs you', count: counts.attn, dotClassName: 'bg-warning' },
    { id: 'review', label: 'in review', count: counts.review, dotClassName: 'bg-review' },
    { id: 'done', label: 'done', count: counts.done, dotClassName: 'bg-success' },
  ];

  return (
    <div className="fixed inset-0 flex flex-col overflow-y-auto bg-background text-foreground">
      <header className="flex flex-shrink-0 flex-wrap items-center gap-4 border-b border-border px-6 py-4">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">Overview</h1>
        <div className="ml-auto">
          {isLoading ? (
            <span className="text-sm text-muted-foreground">Loading…</span>
          ) : (
            <FilterChips
              options={chipOptions}
              active={active}
              // FilterChips is id-agnostic for reuse; narrow back to the known ids here.
              onToggle={(id) => {
                if (isOverviewFilterId(id)) {
                  toggle(id);
                }
              }}
              onAll={selectAll}
            />
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-9 p-6">
        <section>
          <SectionTitle
            title="Sessions"
            caption={`${visibleSessions.length} in the last 24h · click opens the chat`}
          />
          <SessionsSection sessions={visibleSessions} />
        </section>

        <section>
          <SectionTitle
            title="Tasks"
            caption={`${visibleTasks.length} ${visibleTasks.length === 1 ? 'task' : 'tasks'} · click opens the task on the board`}
          />
          <TasksSection tasks={visibleTasks} showDone={active.has('done')} />
        </section>

        <section>
          <SectionTitle
            title="Boards"
            caption={`${boards.length} ${boards.length === 1 ? 'project' : 'projects'} with a board · click a ticket opens the board`}
          />
          <BoardsSection boards={boards} dimmedColumns={dimmedColumns} />
        </section>
      </div>
    </div>
  );
}
