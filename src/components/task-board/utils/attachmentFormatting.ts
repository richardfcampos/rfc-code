// Pure formatting/classification helpers for task attachments, kept free of
// React and fetch so they are unit-testable in isolation (see
// attachmentFormatting.test.ts).

/** Same cap the server enforces (`TASK_ATTACHMENT_MAX_SIZE_BYTES` in
 * `server/modules/tasks/tasks.validation.ts`) — checked client-side purely to
 * skip a doomed upload round-trip; the server re-checks regardless. Frontend
 * does not import server modules (see `types.ts`), so the value is copied. */
export const TASK_ATTACHMENT_MAX_SIZE_BYTES = 20 * 1024 * 1024;

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** Formats a byte count as a short human-readable size, e.g. `1536` -> `"1.5 KB"`. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes === 0) {
    return '0 B';
  }

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const formatted = exponent === 0 ? String(value) : value.toFixed(value < 10 ? 1 : 0);
  return `${formatted} ${SIZE_UNITS[exponent]}`;
}

/** Whether a mime type should render as an inline preview rather than just a file row. */
export function isImageMimeType(mimeType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)$/i.test(mimeType.trim());
}

export type AttachmentSizeValidation = { ok: true } | { ok: false; reason: string };

/** Validates a File before upload starts — mirrors the server's own cap so the failure is instant. */
export function validateAttachmentSize(sizeBytes: number, fileName: string): AttachmentSizeValidation {
  if (sizeBytes > TASK_ATTACHMENT_MAX_SIZE_BYTES) {
    return { ok: false, reason: `${fileName} is larger than ${formatFileSize(TASK_ATTACHMENT_MAX_SIZE_BYTES)}` };
  }
  return { ok: true };
}
