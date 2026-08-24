// DOM-only download glue — same pattern as `triggerBrowserDownload` in
// `file-tree/hooks/useFileTreeOperations.ts`. No pure logic to unit test here
// (it is a single imperative browser API sequence), so it is left uncovered
// like its file-tree counterpart.
export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}
