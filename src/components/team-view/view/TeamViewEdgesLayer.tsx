import { edgeStateStyle } from '../utils/teamViewStateStyles';
import type { TeamViewLayoutEdge } from '../utils/teamViewLayout';

type TeamViewEdgesLayerProps = {
  edges: TeamViewLayoutEdge[];
  width: number;
  height: number;
};

/**
 * Pure SVG line layer for handoff edges, absolutely positioned under the node
 * cards. `pointer-events-none` so the lines never intercept clicks meant for
 * the nodes above them — this whole surface is read-only anyway (C2).
 */
export default function TeamViewEdgesLayer({ edges, width, height }: TeamViewEdgesLayerProps) {
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={width}
      height={height}
      aria-hidden="true"
    >
      <defs>
        <marker id="team-view-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>
      {edges.map(({ edge, x1, y1, x2, y2 }) => {
        const style = edgeStateStyle(edge.state);
        return (
          <line
            key={edge.messageId}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className={style.colorClassName}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray={style.dashArray}
            markerEnd="url(#team-view-arrow)"
          >
            <title>{`${style.label}: ${edge.subject}`}</title>
          </line>
        );
      })}
    </svg>
  );
}
