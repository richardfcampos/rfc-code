/**
 * The product mark: a terminal prompt (`>_`).
 *
 * Shared by the sidebar header and the collapsed rail so the two can never
 * drift apart, and drawn inline rather than pulled from an icon set because
 * the mark carries brand weight (2.2 stroke) that the icon defaults do not.
 */
export default function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="5 8 9 12 5 16" />
      <line x1="12" y1="17" x2="19" y2="17" />
    </svg>
  );
}
