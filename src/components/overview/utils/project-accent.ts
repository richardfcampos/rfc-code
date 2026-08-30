/**
 * Deterministic per-project accent color for the overview dashboard, so a
 * project's card, avatar, etc. always render the same hue across sessions.
 */

/** Fixed hue palette — order is arbitrary but must stay stable once shipped,
 * since existing projects' assigned colors depend on each hue's index. */
export const PROJECT_ACCENT_PALETTE = [
  'hsl(217 91% 66%)', // blue
  'hsl(142 71% 45%)', // green
  'hsl(25 95% 53%)', // orange
  'hsl(262 83% 66%)', // purple
  'hsl(173 80% 40%)', // teal
  'hsl(330 81% 60%)', // pink
  'hsl(43 96% 56%)', // amber
  'hsl(189 94% 43%)', // cyan
] as const;

export type ProjectAccent = {
  hue: string;
};

export function getProjectAccent(projectId: string): ProjectAccent {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % PROJECT_ACCENT_PALETTE.length;
  return { hue: PROJECT_ACCENT_PALETTE[index] };
}
