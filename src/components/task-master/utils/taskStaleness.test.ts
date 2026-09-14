import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isStaleClosedTask } from './taskStaleness';

const NOW = Date.parse('2026-09-14T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe('isStaleClosedTask', () => {
  it('hides done and cancelled tasks older than the threshold', () => {
    assert.equal(isStaleClosedTask({ id: 1, title: 't', status: 'done', updatedAt: daysAgo(8) }, 7, NOW), true);
    assert.equal(isStaleClosedTask({ id: 1, title: 't', status: 'cancelled', updatedAt: daysAgo(8) }, 7, NOW), true);
  });

  it('keeps recently closed tasks', () => {
    assert.equal(isStaleClosedTask({ id: 1, title: 't', status: 'done', updatedAt: daysAgo(6) }, 7, NOW), false);
  });

  it('never hides open tasks, regardless of age', () => {
    assert.equal(isStaleClosedTask({ id: 1, title: 't', status: 'pending', updatedAt: daysAgo(90) }, 7, NOW), false);
    assert.equal(isStaleClosedTask({ id: 1, title: 't', status: 'in-progress', updatedAt: daysAgo(90) }, 7, NOW), false);
  });

  it('is disabled when the threshold is zero', () => {
    assert.equal(isStaleClosedTask({ id: 1, title: 't', status: 'done', updatedAt: daysAgo(400) }, 0, NOW), false);
  });

  it('keeps closed tasks with no usable updatedAt', () => {
    assert.equal(isStaleClosedTask({ id: 1, title: 't', status: 'done' }, 7, NOW), false);
    assert.equal(isStaleClosedTask({ id: 1, title: 't', status: 'done', updatedAt: 'not a date' }, 7, NOW), false);
  });
});
