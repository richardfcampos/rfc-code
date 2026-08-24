import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CronParseError,
  cronMatches,
  cronMinuteKey,
  parseCronExpression,
} from '@/modules/automations/services/cron-expression.js';

function due(expression: string, iso: string): boolean {
  return cronMatches(parseCronExpression(expression), new Date(iso));
}

test('every-minute expressions are always due', () => {
  assert.equal(due('* * * * *', '2026-08-24T13:37:00'), true);
});

test('a fixed minute and hour is due only at that minute', () => {
  assert.equal(due('30 3 * * *', '2026-08-24T03:30:00'), true);
  assert.equal(due('30 3 * * *', '2026-08-24T03:31:00'), false);
  assert.equal(due('30 3 * * *', '2026-08-24T04:30:00'), false);
});

test('step expressions match their multiples', () => {
  const schedule = parseCronExpression('*/15 * * * *');
  assert.deepEqual([...schedule.minutes], [0, 15, 30, 45]);
  assert.equal(cronMatches(schedule, new Date('2026-08-24T09:45:00')), true);
  assert.equal(cronMatches(schedule, new Date('2026-08-24T09:46:00')), false);
});

test('ranges, lists and stepped ranges are supported', () => {
  assert.equal(due('0 9-17 * * *', '2026-08-24T09:00:00'), true);
  assert.equal(due('0 9-17 * * *', '2026-08-24T18:00:00'), false);
  assert.equal(due('0,30 * * * *', '2026-08-24T11:30:00'), true);
  assert.equal(due('0,30 * * * *', '2026-08-24T11:15:00'), false);
  assert.deepEqual([...parseCronExpression('0-10/5 * * * *').minutes], [0, 5, 10]);
});

test('day-of-week accepts both 0 and 7 for Sunday', () => {
  // 2026-08-23 is a Sunday.
  assert.equal(due('0 8 * * 0', '2026-08-23T08:00:00'), true);
  assert.equal(due('0 8 * * 7', '2026-08-23T08:00:00'), true);
  assert.equal(due('0 8 * * 1', '2026-08-23T08:00:00'), false);
});

test('a restricted day-of-month and day-of-week are ORed, as crontab does', () => {
  // The 1st of the month, which in 2026-09 is a Tuesday (day 2).
  assert.equal(due('0 0 1 * 5', '2026-09-01T00:00:00'), true);
  // A Friday that is not the 1st still matches through the day-of-week field.
  assert.equal(due('0 0 1 * 5', '2026-09-04T00:00:00'), true);
  assert.equal(due('0 0 1 * 5', '2026-09-03T00:00:00'), false);
});

test('an unrestricted day-of-week does not widen a restricted day-of-month', () => {
  assert.equal(due('0 0 15 * *', '2026-09-15T00:00:00'), true);
  assert.equal(due('0 0 15 * *', '2026-09-16T00:00:00'), false);
});

test('the month field is honoured', () => {
  assert.equal(due('0 0 * 9 *', '2026-09-10T00:00:00'), true);
  assert.equal(due('0 0 * 9 *', '2026-08-10T00:00:00'), false);
});

test('malformed expressions are refused with a reason', () => {
  assert.throws(() => parseCronExpression('* * * *'), CronParseError);
  assert.throws(() => parseCronExpression('60 * * * *'), /minute must be between 0 and 59/);
  assert.throws(() => parseCronExpression('* 24 * * *'), /hour must be between/);
  assert.throws(() => parseCronExpression('MON * * * *'), /not a valid minute value/);
  assert.throws(() => parseCronExpression('10-5 * * * *'), /runs backwards/);
  assert.throws(() => parseCronExpression('0,, * * * *'), /empty term/);
  assert.throws(() => parseCronExpression('*/0 * * * *'), /step must be between/);
});

test('the minute key identifies the local minute a tick lands in', () => {
  assert.equal(cronMinuteKey(new Date(2026, 7, 24, 3, 5)), '2026-08-24T03:05');
  assert.equal(cronMinuteKey(new Date(2026, 11, 1, 23, 59)), '2026-12-01T23:59');
});
