/**
 * Formats a timestamp as a 24-hour `HH:MM` mono label, matching the export's
 * turn-head style (`14:29`). Returns `undefined` for a missing/unparsable
 * timestamp so callers can omit the segment instead of showing "Invalid Date".
 */
export function formatClockTime(timestamp: string | number | Date | undefined | null): string | undefined {
  if (timestamp === undefined || timestamp === null) {
    return undefined;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
