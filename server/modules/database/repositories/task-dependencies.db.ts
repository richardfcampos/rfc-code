/**
 * Persistence for task decomposition: subtasks and the ordering edges between
 * them.
 *
 * Kept apart from `tasks.db.ts` because everything here is about a *graph* of
 * tasks rather than one row: a decomposition is written in a single
 * transaction (a half-created plan is worse than none), and the "what can start
 * now" question is one query over subtasks joined to their unmet dependencies
 * rather than a read the caller could assemble itself without N round trips.
 */

import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';
import { TASK_COLUMNS } from '@/modules/database/repositories/tasks.db.js';
import type { TaskRow } from '@/modules/database/repositories/tasks.db.js';

/** A task row read through the decomposition lens, so the parent link is visible. */
export type SubtaskRow = TaskRow & { parent_task_id: string | null };

export type TaskDependencyRow = {
  task_id: string;
  depends_on_task_id: string;
  created_at: string;
};

/**
 * One subtask to create, with its dependencies expressed as positions in the
 * same batch — the rows have no ids until the transaction runs, so the caller
 * cannot name them any other way.
 */
export type SubtaskDraft = {
  title: string;
  description?: string | null;
  suggestedSkill?: string | null;
  /** Indices into the same `subtasks` array this draft belongs to. */
  dependsOn: number[];
};

export type CreateDecompositionInput = {
  parentTaskId: string;
  projectName: string;
  origin?: TaskRow['origin'];
  originDetail?: string | null;
  subtasks: SubtaskDraft[];
};

const SUBTASK_COLUMNS =
  'id, project_name, title, description, stage, origin, origin_detail, assignee_profile_id, ' +
  'suggested_skill, worktree_branch, parent_task_id, created_at, updated_at';

const DEPENDENCY_COLUMNS = 'task_id, depends_on_task_id, created_at';

/** Same column lists, qualified for the joined queries below. */
const qualify = (alias: string, columns: string): string =>
  columns
    .split(', ')
    .map((column) => `${alias}.${column}`)
    .join(', ');

/** Subtasks in creation order, which is the order the plan was written in. */
function selectSubtasks(parentTaskId: string): SubtaskRow[] {
  return getConnection()
    .prepare(
      `SELECT ${SUBTASK_COLUMNS} FROM tasks
       WHERE parent_task_id = ?
       ORDER BY datetime(created_at), rowid`,
    )
    .all(parentTaskId) as SubtaskRow[];
}

export const taskDependenciesDb = {
  /**
   * Creates a whole decomposition — every subtask and every edge — atomically.
   *
   * All-or-nothing on purpose: a plan that lost half its dependencies would
   * read as "ready to start" for work that is not, so a failure anywhere rolls
   * the entire batch back and leaves the parent exactly as it was.
   *
   * `dependsOn` indices are trusted here; the service layer validates that they
   * are in range and acyclic before calling.
   */
  createDecomposition(input: CreateDecompositionInput): SubtaskRow[] {
    const db = getConnection();
    const ids = input.subtasks.map(() => randomUUID());

    const insertTask = db.prepare(
      `INSERT INTO tasks (
         id, project_name, title, description, stage, origin, origin_detail,
         suggested_skill, parent_task_id
       ) VALUES (?, ?, ?, ?, 'backlog', ?, ?, ?, ?)`,
    );
    // Plain INSERT, not INSERT OR IGNORE: a rejected edge (self-dependency, a
    // repeated pair) means the caller handed over a plan it had not validated,
    // and swallowing it would store a decomposition that differs from the one
    // that was asked for.
    const insertEdge = db.prepare(
      `INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)`,
    );

    const write = db.transaction(() => {
      input.subtasks.forEach((subtask, index) => {
        insertTask.run(
          ids[index],
          input.projectName,
          subtask.title,
          subtask.description ?? null,
          input.origin ?? 'agent',
          input.originDetail ?? null,
          subtask.suggestedSkill ?? null,
          input.parentTaskId,
        );
      });

      input.subtasks.forEach((subtask, index) => {
        for (const dependencyIndex of subtask.dependsOn) {
          insertEdge.run(ids[index], ids[dependencyIndex]);
        }
      });
    });

    write();
    // Read back through the same projection every other call uses, so callers
    // never have to reconcile two shapes of "subtask".
    return selectSubtasks(input.parentTaskId);
  },

  listSubtasks(parentTaskId: string): SubtaskRow[] {
    return selectSubtasks(parentTaskId);
  },

  /** Every edge whose dependent side is a subtask of this parent. */
  listDependencies(parentTaskId: string): TaskDependencyRow[] {
    return getConnection()
      .prepare(
        `SELECT ${qualify('d', DEPENDENCY_COLUMNS)}
         FROM task_dependencies d
         JOIN tasks t ON t.id = d.task_id
         WHERE t.parent_task_id = ?
         ORDER BY datetime(d.created_at), d.rowid`,
      )
      .all(parentTaskId) as TaskDependencyRow[];
  },

  /**
   * Subtasks that can be picked up right now: still in `backlog`, and with
   * nothing they depend on left unfinished.
   *
   * Stages past `backlog` are excluded because they are already somebody's
   * work — handing them out again is how two agents end up on one branch.
   */
  listReady(parentTaskId: string): SubtaskRow[] {
    return getConnection()
      .prepare(
        `SELECT ${qualify('t', SUBTASK_COLUMNS)}
         FROM tasks t
         WHERE t.parent_task_id = ?
           AND t.stage = 'backlog'
           AND NOT EXISTS (
             SELECT 1 FROM task_dependencies d
             JOIN tasks blocker ON blocker.id = d.depends_on_task_id
             WHERE d.task_id = t.id AND blocker.stage <> 'done'
           )
         ORDER BY datetime(t.created_at), t.rowid`,
      )
      .all(parentTaskId) as SubtaskRow[];
  },

  /**
   * Backlog tasks anywhere in a project that can be picked up right now:
   * still in `backlog`, with nothing they depend on left unfinished.
   *
   * Unlike `listReady`, this is not scoped to one decomposition's subtasks —
   * it walks the whole project, top-level tickets and subtasks alike. A
   * subtask with every dependency done is ready work exactly like a top-level
   * ticket; excluding it would leave a decomposed plan's later steps stuck
   * even once nothing blocks them.
   */
  listReadyBacklogByProject(projectName: string): TaskRow[] {
    return getConnection()
      .prepare(
        `SELECT ${qualify('t', TASK_COLUMNS)}
         FROM tasks t
         WHERE t.project_name = ?
           AND t.stage = 'backlog'
           AND NOT EXISTS (
             SELECT 1 FROM task_dependencies d
             JOIN tasks blocker ON blocker.id = d.depends_on_task_id
             WHERE d.task_id = t.id AND blocker.stage <> 'done'
           )
         ORDER BY datetime(t.created_at), t.rowid`,
      )
      .all(projectName) as TaskRow[];
  },

  /**
   * The tasks this one waits on that are not done yet.
   *
   * Empty for a task with no dependencies, which is what makes it a safe check
   * to run before handing any task to somebody.
   */
  listBlockers(taskId: string): SubtaskRow[] {
    return getConnection()
      .prepare(
        `SELECT ${qualify('blocker', SUBTASK_COLUMNS)}
         FROM task_dependencies d
         JOIN tasks blocker ON blocker.id = d.depends_on_task_id
         WHERE d.task_id = ? AND blocker.stage <> 'done'
         ORDER BY datetime(blocker.created_at), blocker.rowid`,
      )
      .all(taskId) as SubtaskRow[];
  },

  get(taskId: string): SubtaskRow | null {
    const row = getConnection()
      .prepare(`SELECT ${SUBTASK_COLUMNS} FROM tasks WHERE id = ?`)
      .get(taskId) as SubtaskRow | undefined;
    return row ?? null;
  },
};
