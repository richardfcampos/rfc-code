/**
 * Application service for breaking a task into subtasks with dependencies.
 *
 * This is the "maestro" half of the task board: a leader session writes a plan
 * once, and everything downstream (which subtask can start, who it goes to)
 * reads from it. Validation is therefore stricter than for a single task —
 * a plan that references a subtask that does not exist, or that waits on
 * itself in a loop, would park work forever instead of failing loudly, so
 * both are rejected before anything is written.
 */

import {
  taskDependenciesDb,
  type SubtaskDraft,
  type SubtaskRow,
  type TaskDependencyRow,
} from '@/modules/database/index.js';

import { TaskNotFoundError, TaskValidationError } from '../tasks.errors.js';
import { readOptionalNullableString, requireTaskId, validateTitle } from '../tasks.validation.js';

/** Guardrail against a runaway plan; well past anything a useful decomposition needs. */
export const MAX_SUBTASKS_PER_DECOMPOSITION = 50;

/** Raw request bodies straight off the wire; every field is unvalidated. */
export type DecomposeRequestBody = Record<string, unknown>;

/** A parent task with the plan hanging off it. */
export type TaskDecomposition = {
  parent: SubtaskRow;
  subtasks: SubtaskRow[];
  dependencies: TaskDependencyRow[];
};

export type TaskDecompositionService = {
  decompose(parentTaskId: unknown, body: DecomposeRequestBody): TaskDecomposition;
  getDecomposition(parentTaskId: unknown): TaskDecomposition;
  listReady(parentTaskId: unknown): SubtaskRow[];
};

function requireParent(rawParentTaskId: unknown): SubtaskRow {
  const parentTaskId = requireTaskId(rawParentTaskId);
  // Read through the decomposition repository rather than the plain task one:
  // the parent link is what tells a nested decomposition apart from a top-level
  // task, and it is not part of the flat task projection.
  const parent = taskDependenciesDb.get(parentTaskId);
  if (!parent) {
    throw new TaskNotFoundError(parentTaskId);
  }
  return parent;
}

/**
 * Reads the `dependsOn` list of one draft: positions in the same batch, since
 * the subtasks have no ids until they are written.
 */
function readDependsOn(raw: unknown, index: number, total: number): number[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new TaskValidationError(`subtasks[${index}].dependsOn must be an array of indices`);
  }

  const seen = new Set<number>();
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= total) {
      throw new TaskValidationError(
        `subtasks[${index}].dependsOn must contain integers between 0 and ${total - 1}`,
      );
    }
    if (value === index) {
      throw new TaskValidationError(`subtasks[${index}] cannot depend on itself`);
    }
    // A repeated index is the same edge asked for twice; the storage layer
    // refuses duplicates, so collapse them here where the intent is obvious.
    seen.add(value);
  }

  return [...seen];
}

/**
 * Rejects a plan whose dependencies form a cycle.
 *
 * A cycle is not a storage error — every row inserts fine — but nothing in it
 * would ever become ready, so the decomposition would look healthy while never
 * producing a single delegable subtask. Kahn's algorithm: if any node is left
 * after repeatedly removing the ones with no unmet dependencies, they hold a
 * cycle between them.
 */
function assertAcyclic(drafts: SubtaskDraft[]): void {
  const remaining = new Map<number, Set<number>>(
    drafts.map((draft, index) => [index, new Set(draft.dependsOn)]),
  );

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [index, dependencies] of remaining) {
      if (dependencies.size > 0) {
        continue;
      }
      remaining.delete(index);
      for (const others of remaining.values()) {
        others.delete(index);
      }
      progressed = true;
    }
  }

  if (remaining.size > 0) {
    const cycle = [...remaining.keys()].sort((a, b) => a - b).join(', ');
    throw new TaskValidationError(
      `subtasks form a dependency cycle (indices: ${cycle}); no subtask in it could ever start`,
    );
  }
}

function readDrafts(body: DecomposeRequestBody): SubtaskDraft[] {
  const raw = body.subtasks;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TaskValidationError('subtasks must be a non-empty array');
  }
  if (raw.length > MAX_SUBTASKS_PER_DECOMPOSITION) {
    throw new TaskValidationError(
      `a decomposition may hold at most ${MAX_SUBTASKS_PER_DECOMPOSITION} subtasks`,
    );
  }

  const drafts = raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TaskValidationError(`subtasks[${index}] must be an object`);
    }
    const subtask = entry as Record<string, unknown>;

    return {
      title: validateTitle(subtask.title),
      description: readOptionalNullableString(subtask.description, `subtasks[${index}].description`) ?? null,
      // `skill` is the field name the MCP tool exposes; `suggested_skill` is
      // the column, and both are accepted so a caller can use either.
      suggestedSkill:
        readOptionalNullableString(
          subtask.skill ?? subtask.suggested_skill,
          `subtasks[${index}].skill`,
        ) ?? null,
      dependsOn: readDependsOn(subtask.dependsOn, index, raw.length),
    };
  });

  assertAcyclic(drafts);
  return drafts;
}

function decompose(
  rawParentTaskId: unknown,
  body: DecomposeRequestBody,
): TaskDecomposition {
  const parent = requireParent(rawParentTaskId);
  if (parent.parent_task_id) {
    // One level only: a subtask of a subtask has no owner in the board's model,
    // and a maestro that nests loses track of what "all subtasks done" means.
    throw new TaskValidationError(
      `Task "${parent.id}" is already a subtask; decompose its parent instead`,
    );
  }

  const drafts = readDrafts(body);
  const originDetail = readOptionalNullableString(body.origin_detail, 'origin_detail') ?? null;

  taskDependenciesDb.createDecomposition({
    parentTaskId: parent.id,
    // Project comes from the parent, never from the request: a subtask lives on
    // the same board as the work it decomposes.
    projectName: parent.project_name,
    originDetail,
    subtasks: drafts,
  });

  return readDecomposition(parent);
}

function readDecomposition(parent: SubtaskRow): TaskDecomposition {
  return {
    parent,
    subtasks: taskDependenciesDb.listSubtasks(parent.id),
    dependencies: taskDependenciesDb.listDependencies(parent.id),
  };
}

export function createTaskDecompositionService(): TaskDecompositionService {
  return {
    decompose: (parentTaskId, body) => decompose(parentTaskId, body),
    getDecomposition: (parentTaskId) => readDecomposition(requireParent(parentTaskId)),
    listReady: (parentTaskId) => taskDependenciesDb.listReady(requireParent(parentTaskId).id),
  };
}
