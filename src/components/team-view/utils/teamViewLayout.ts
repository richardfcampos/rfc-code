// Pure layout for the Team View graph: no dependency on d3/reactflow/any graph
// library (none is in package.json, and one running-session-per-node grid is
// simple enough not to need one — see the R16 plan's "lightweight approach"
// note). A deterministic grid keeps positions stable across polls: the same
// `sessionId` always lands on the same cell as long as the session list order
// is unchanged, and re-renders never jitter node positions randomly.

import type { TeamViewEdge, TeamViewSession } from '../types';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 68;
const COLUMN_GAP = 56;
const ROW_GAP = 32;
const PADDING = 32;
const DEFAULT_COLUMNS = 3;

export interface TeamViewLayoutNode {
  session: TeamViewSession;
  x: number;
  y: number;
}

export interface TeamViewLayoutEdge {
  edge: TeamViewEdge;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TeamViewLayout {
  nodes: TeamViewLayoutNode[];
  edges: TeamViewLayoutEdge[];
  width: number;
  height: number;
}

/** Grid columns for `count` nodes: never more columns than nodes, capped at `maxColumns`. */
function resolveColumns(count: number, maxColumns: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(maxColumns, count));
}

/**
 * Places every session on a deterministic grid (top-left origin) and draws
 * each edge as a straight line between the two node centers. Edges whose
 * endpoint is not in `sessions` are dropped — the server only emits edges
 * between two currently-running sessions, but this stays defensive rather
 * than rendering a line to nowhere if that contract is ever violated.
 */
export function computeTeamViewLayout(
  sessions: TeamViewSession[],
  edges: TeamViewEdge[],
  options: { columns?: number } = {},
): TeamViewLayout {
  const columns = resolveColumns(sessions.length, options.columns ?? DEFAULT_COLUMNS);
  const rows = columns > 0 ? Math.ceil(sessions.length / columns) : 0;

  const centerOf = new Map<string, { x: number; y: number }>();
  const nodes: TeamViewLayoutNode[] = sessions.map((session, index) => {
    const col = index % Math.max(columns, 1);
    const row = Math.floor(index / Math.max(columns, 1));
    const x = PADDING + col * (NODE_WIDTH + COLUMN_GAP);
    const y = PADDING + row * (NODE_HEIGHT + ROW_GAP);
    centerOf.set(session.sessionId, { x: x + NODE_WIDTH / 2, y: y + NODE_HEIGHT / 2 });
    return { session, x, y };
  });

  const layoutEdges: TeamViewLayoutEdge[] = [];
  for (const edge of edges) {
    const from = centerOf.get(edge.fromSessionId);
    const to = centerOf.get(edge.toSessionId);
    if (!from || !to) {
      continue;
    }
    layoutEdges.push({ edge, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  }

  const width = columns > 0 ? PADDING * 2 + columns * NODE_WIDTH + (columns - 1) * COLUMN_GAP : PADDING * 2;
  const height = rows > 0 ? PADDING * 2 + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP : PADDING * 2;

  return { nodes, edges: layoutEdges, width, height };
}
