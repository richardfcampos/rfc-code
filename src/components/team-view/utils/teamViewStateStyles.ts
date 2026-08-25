// Pure label/color-class lookups for handoff edge and session states, kept
// separate from the view so they are testable without rendering anything.
// Colors are Tailwind text-color utility classes (`text-success`, ...) that
// SVG elements pick up via `stroke="currentColor"` / a `currentColor` fill —
// the same "className drives currentColor" idiom the rest of the app uses
// for icons, so no raw hex/HSL values are hardcoded here.

import type { AgentMessageState } from '../types';

export interface EdgeStateStyle {
  colorClassName: string;
  /** SVG `stroke-dasharray`; settled states (answered/failed) render solid (undefined). */
  dashArray: string | undefined;
  label: string;
}

const EDGE_STATE_STYLES: Record<AgentMessageState, EdgeStateStyle> = {
  queued: { colorClassName: 'text-muted-foreground', dashArray: '4 3', label: 'Queued' },
  delivered: { colorClassName: 'text-warning', dashArray: '4 3', label: 'Delivered' },
  acknowledged: { colorClassName: 'text-primary', dashArray: '4 3', label: 'Acknowledged' },
  answered: { colorClassName: 'text-success', dashArray: undefined, label: 'Answered' },
  failed: { colorClassName: 'text-danger', dashArray: undefined, label: 'Failed' },
};

export function edgeStateStyle(state: AgentMessageState): EdgeStateStyle {
  return EDGE_STATE_STYLES[state];
}

export function sessionStateDotClassName(state: 'running' | 'idle'): string {
  return state === 'running' ? 'bg-success' : 'bg-muted-foreground';
}
