/**
 * Turns a unified diff into renderable lines that carry a line number.
 *
 * The git panel's viewer only classifies a line as added/removed/header, which
 * is enough to read a diff but not to anchor a comment. A per-line comment
 * needs the number the reviewer sees, so hunk headers are parsed here and the
 * new-file counter is carried across the hunk.
 */

export type ReviewDiffLineKind = 'addition' | 'deletion' | 'context' | 'hunk' | 'meta';

export interface ReviewDiffLine {
  text: string;
  kind: ReviewDiffLineKind;
  /** Line number in the reviewed (new) file; null for deletions and headers. */
  newLineNo: number | null;
  /** Line number in the base file; null for additions and headers. */
  oldLineNo: number | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Diff lines are cheap to render but huge diffs are not — the caller slices. */
export function parseReviewDiffLines(diff: string): ReviewDiffLine[] {
  const lines: ReviewDiffLine[] = [];
  let oldLineNo = 0;
  let newLineNo = 0;
  let insideHunk = false;

  for (const text of diff.split('\n')) {
    const hunk = HUNK_HEADER.exec(text);
    if (hunk) {
      oldLineNo = Number.parseInt(hunk[1], 10);
      newLineNo = Number.parseInt(hunk[2], 10);
      insideHunk = true;
      lines.push({ text, kind: 'hunk', newLineNo: null, oldLineNo: null });
      continue;
    }

    if (!insideHunk) {
      // `diff --git`, `index`, `---`, `+++` and friends.
      lines.push({ text, kind: 'meta', newLineNo: null, oldLineNo: null });
      continue;
    }

    if (text.startsWith('+')) {
      lines.push({ text, kind: 'addition', newLineNo, oldLineNo: null });
      newLineNo += 1;
      continue;
    }
    if (text.startsWith('-')) {
      lines.push({ text, kind: 'deletion', newLineNo: null, oldLineNo });
      oldLineNo += 1;
      continue;
    }
    if (text.startsWith('\\')) {
      // "\ No newline at end of file" belongs to the previous line.
      lines.push({ text, kind: 'meta', newLineNo: null, oldLineNo: null });
      continue;
    }

    lines.push({ text, kind: 'context', newLineNo, oldLineNo });
    newLineNo += 1;
    oldLineNo += 1;
  }

  // A trailing newline in the diff produces one empty line nobody wants.
  if (lines.length > 0 && lines[lines.length - 1].text === '') {
    lines.pop();
  }

  return lines;
}

/** Groups a review's comments by the line they are anchored to. */
export function groupCommentsByLine<T extends { line_no: number | null }>(
  comments: T[],
): Map<number, T[]> {
  const byLine = new Map<number, T[]>();
  for (const comment of comments) {
    if (comment.line_no === null) {
      continue;
    }
    const existing = byLine.get(comment.line_no);
    if (existing) {
      existing.push(comment);
    } else {
      byLine.set(comment.line_no, [comment]);
    }
  }
  return byLine;
}
