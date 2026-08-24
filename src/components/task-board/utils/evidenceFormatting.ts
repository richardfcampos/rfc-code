// Pure helpers for rendering task evidence entries — kind labels/icons and
// link-vs-plain-text classification, split out so they are unit-testable.

import type { TaskEvidenceKind } from '../types';

export const TASK_EVIDENCE_KINDS: readonly TaskEvidenceKind[] = ['note', 'link', 'attachment'];

const EVIDENCE_KIND_LABELS: Record<TaskEvidenceKind, string> = {
  note: 'Note',
  link: 'Link',
  attachment: 'Attachment',
};

export function evidenceKindLabel(kind: TaskEvidenceKind): string {
  return EVIDENCE_KIND_LABELS[kind];
}

/** A `link` evidence's content is free text (README: may be a URL or a file path) — only render it as a clickable external link when it actually is one. */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
