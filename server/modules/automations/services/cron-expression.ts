/**
 * A minute-granularity matcher for standard five-field cron expressions.
 *
 * Written here rather than pulled in as a dependency because the scheduler asks
 * exactly one question — "is this expression due at this minute?" — and needs no
 * next-fire arithmetic, no timezone database and no job registry. Expressions
 * are evaluated against the server's local time, which is the same clock the
 * rest of the board shows.
 *
 * Supported per field: `*`, `n`, `a-b`, `*\/step`, `a-b/step` and comma-separated
 * lists of any of those. Names ("MON", "JAN") are not supported and are refused
 * at validation time rather than silently never matching.
 */

export interface CronSchedule {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** Standard cron ORs day-of-month with day-of-week when both are restricted. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELDS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  // 7 is accepted as an alias for Sunday, the way crontab does.
  { name: 'day-of-week', min: 0, max: 7 },
];

export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronParseError';
  }
}

function readInteger(raw: string, field: FieldSpec): number {
  if (!/^\d+$/.test(raw)) {
    throw new CronParseError(`"${raw}" is not a valid ${field.name} value`);
  }
  const value = Number(raw);
  if (value < field.min || value > field.max) {
    throw new CronParseError(`${field.name} must be between ${field.min} and ${field.max}, got ${value}`);
  }
  return value;
}

function parseTerm(term: string, field: FieldSpec, values: Set<number>): void {
  const [rangePart, stepPart, ...extra] = term.split('/');
  if (extra.length > 0) {
    throw new CronParseError(`"${term}" is not a valid ${field.name} expression`);
  }

  let step = 1;
  if (stepPart !== undefined) {
    step = readInteger(stepPart, { name: `${field.name} step`, min: 1, max: field.max });
  }

  let start = field.min;
  let end = field.max;
  if (rangePart !== '*') {
    const bounds = rangePart.split('-');
    if (bounds.length === 1) {
      start = readInteger(bounds[0], field);
      end = stepPart === undefined ? start : field.max;
    } else if (bounds.length === 2) {
      start = readInteger(bounds[0], field);
      end = readInteger(bounds[1], field);
      if (end < start) {
        throw new CronParseError(`${field.name} range "${rangePart}" runs backwards`);
      }
    } else {
      throw new CronParseError(`"${term}" is not a valid ${field.name} expression`);
    }
  }

  for (let value = start; value <= end; value += step) {
    // Sunday is both 0 and 7 in crontab; store it as 0 so matching is a plain lookup.
    values.add(field.name === 'day-of-week' && value === 7 ? 0 : value);
  }
}

function parseField(raw: string, field: FieldSpec): { values: Set<number>; restricted: boolean } {
  const values = new Set<number>();
  const terms = raw.split(',');
  for (const term of terms) {
    if (term.trim() === '') {
      throw new CronParseError(`${field.name} has an empty term`);
    }
    parseTerm(term.trim(), field, values);
  }
  return { values, restricted: raw.trim() !== '*' };
}

/** Parses a five-field expression, or throws `CronParseError` describing the offending field. */
export function parseCronExpression(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronParseError(
      `A cron expression needs 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`,
    );
  }

  const minute = parseField(parts[0], FIELDS[0]);
  const hour = parseField(parts[1], FIELDS[1]);
  const dayOfMonth = parseField(parts[2], FIELDS[2]);
  const month = parseField(parts[3], FIELDS[3]);
  const dayOfWeek = parseField(parts[4], FIELDS[4]);

  return {
    minutes: minute.values,
    hours: hour.values,
    daysOfMonth: dayOfMonth.values,
    months: month.values,
    daysOfWeek: dayOfWeek.values,
    dayOfMonthRestricted: dayOfMonth.restricted,
    dayOfWeekRestricted: dayOfWeek.restricted,
  };
}

/** True when the expression is due at `date`'s minute (seconds are ignored). */
export function cronMatches(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.minutes.has(date.getMinutes())) return false;
  if (!schedule.hours.has(date.getHours())) return false;
  if (!schedule.months.has(date.getMonth() + 1)) return false;

  const dayOfMonthHit = schedule.daysOfMonth.has(date.getDate());
  const dayOfWeekHit = schedule.daysOfWeek.has(date.getDay());

  if (schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) {
    return dayOfMonthHit || dayOfWeekHit;
  }
  return dayOfMonthHit && dayOfWeekHit;
}

/** Local-time minute bucket, used as the dedupe key of a cron firing. */
export function cronMinuteKey(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}
