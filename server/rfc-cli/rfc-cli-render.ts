/** Text helpers shared by the human renderings of the `rfc` subcommands. */

/** `3m 04s`, `1h 02m`, `12s`; `-` when unknown. */
export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/** Cuts at `max` characters, appending an ellipsis when something was dropped. */
export function truncate(text: string | null | undefined, max: number): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/** Drops C0/DEL control bytes (ESC, OSC, …) except newline and tab, so agent text cannot drive the terminal. */
export function stripControlChars(text: string): string {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

export function orDash(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

/** Aligns `key: value` lines on the longest key. */
export function keyValueLines(entries: Array<[string, string]>): string {
  const width = entries.reduce((max, [key]) => Math.max(max, key.length), 0);
  return entries.map(([key, value]) => `${key.padEnd(width)}  ${value}`).join('\n');
}

/** Fixed-width columns for one-line-per-row listings. */
export function table(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) => row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index]))).join('  ').trimEnd())
    .join('\n');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
