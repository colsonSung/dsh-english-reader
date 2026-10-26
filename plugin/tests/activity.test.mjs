/**
 * Reading activity tests.
 *
 * Run: node --test tests/activity.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyActivity,
  localDayKey,
  readingStreak,
  recordReading,
  summarizeActivity,
} from '../src/lib/activity.js';

/**
 * A timestamp on a local calendar day.
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} [hour]
 * @param {number} [minute]
 * @returns {number}
 */
function at(year, month, day, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

/**
 * The local day key of a timestamp, computed independently of the module.
 * @param {number} timestamp
 * @returns {string}
 */
function expectedKey(timestamp) {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

test('an empty activity starts from zero', () => {
  const activity = emptyActivity();
  assert.deepEqual(activity, {
    totalMs: 0,
    totalWords: 0,
    lastReadAt: 0,
    startedAt: 0,
    days: {},
  });
});

test('recording reading accumulates time, words and the day bucket', () => {
  const first = at(2024, 5, 1, 9, 0);
  const second = at(2024, 5, 1, 9, 30);

  const activity = recordReading(emptyActivity(), { ms: 60000, words: 120, now: first });
  const later = recordReading(activity, { ms: 30000, words: 45, now: second });

  assert.equal(later.totalMs, 90000);
  assert.equal(later.totalWords, 165);
  assert.equal(later.lastReadAt, second);
  assert.equal(later.startedAt, first);
  assert.deepEqual(later.days, { '2024-05-01': 90000 });
});

test('recording reading never changes the activity it is given', () => {
  const activity = recordReading(emptyActivity(), { ms: 1000, words: 10, now: at(2024, 5, 1) });
  const snapshot = structuredClone(activity);

  recordReading(activity, { ms: 2000, words: 20, now: at(2024, 5, 2) });

  assert.deepEqual(activity, snapshot);
});

test('recording reading works without an activity and ignores missing input', () => {
  const activity = recordReading(undefined, { now: at(2024, 5, 1) });
  assert.equal(activity.totalMs, 0);
  assert.equal(activity.totalWords, 0);
  assert.equal(activity.startedAt, at(2024, 5, 1));
  assert.deepEqual(activity.days, { '2024-05-01': 0 });

  const negative = recordReading(activity, { ms: -500, words: -10, now: at(2024, 5, 1) });
  assert.equal(negative.totalMs, 0);
  assert.equal(negative.totalWords, 0);
});

test('every reading day gets its own bucket', () => {
  let activity = emptyActivity();
  activity = recordReading(activity, { ms: 1000, now: at(2024, 4, 30, 23, 50) });
  activity = recordReading(activity, { ms: 2000, now: at(2024, 5, 1, 0, 10) });
  activity = recordReading(activity, { ms: 3000, now: at(2024, 5, 1, 22, 0) });

  assert.deepEqual(activity.days, {
    '2024-04-30': 1000,
    '2024-05-01': 5000,
  });
  assert.equal(activity.totalMs, 6000);
});

test('the day key follows the local calendar, not UTC', () => {
  const timestamp = at(2024, 5, 1, 0, 30);
  assert.equal(localDayKey(timestamp), expectedKey(timestamp));
  assert.equal(localDayKey(timestamp), '2024-05-01');

  // Offsets other than UTC shift the date, and the key must follow the local
  // one. On a UTC machine the two dates agree, so there is nothing to check.
  const offset = new Date(timestamp).getTimezoneOffset();
  if (offset !== 0) {
    const utcKey = new Date(timestamp).toISOString().slice(0, 10);
    assert.notEqual(localDayKey(timestamp), utcKey);
  }
});

test('the streak counts today and yesterday', () => {
  const today = at(2024, 5, 1, 10, 0);
  const yesterday = at(2024, 4, 30, 10, 0);

  let activity = recordReading(emptyActivity(), { ms: 1000, now: yesterday });
  activity = recordReading(activity, { ms: 1000, now: today });

  assert.equal(readingStreak(activity, today), 2);
});

test('the streak still counts when today has no reading yet', () => {
  const today = at(2024, 5, 1, 10, 0);
  const yesterday = at(2024, 4, 30, 10, 0);
  const dayBefore = at(2024, 4, 29, 10, 0);

  let activity = recordReading(emptyActivity(), { ms: 1000, now: dayBefore });
  activity = recordReading(activity, { ms: 1000, now: yesterday });

  assert.equal(readingStreak(activity, today), 2);
});

test('the streak is zero when neither today nor yesterday was read', () => {
  const today = at(2024, 5, 1, 10, 0);
  const older = at(2024, 4, 20, 10, 0);

  const activity = recordReading(emptyActivity(), { ms: 1000, now: older });

  assert.equal(readingStreak(activity, today), 0);
  assert.equal(readingStreak(emptyActivity(), today), 0);
});

test('the streak stops at a day without reading', () => {
  const today = at(2024, 5, 1, 10, 0);
  const yesterday = at(2024, 4, 30, 10, 0);
  const threeDaysAgo = at(2024, 4, 28, 10, 0);

  let activity = recordReading(emptyActivity(), { ms: 1000, now: threeDaysAgo });
  activity = recordReading(activity, { ms: 1000, now: yesterday });
  activity = recordReading(activity, { ms: 1000, now: today });

  assert.equal(readingStreak(activity, today), 2);
});

test('a day without any reading time does not count towards the streak', () => {
  const today = at(2024, 5, 1, 10, 0);
  const yesterday = at(2024, 4, 30, 10, 0);

  let activity = recordReading(emptyActivity(), { ms: 1000, now: yesterday });
  activity = recordReading(activity, { ms: 0, words: 0, now: today });

  assert.equal(readingStreak(activity, today), 1);
});

test('the summary reports the numbers of the shelf', () => {
  const today = at(2024, 5, 1, 10, 0);
  const yesterday = at(2024, 4, 30, 10, 0);

  let activity = recordReading(emptyActivity(), { ms: 1500, words: 30, now: yesterday });
  activity = recordReading(activity, { ms: 2500, words: 50, now: today });

  assert.deepEqual(summarizeActivity(activity, today), {
    totalMs: 4000,
    totalWords: 80,
    streak: 2,
    lastReadAt: today,
    readTodayMs: 2500,
  });
});

test('the summary of a book that was never read is all zeroes', () => {
  const today = at(2024, 5, 1, 10, 0);
  assert.deepEqual(summarizeActivity(undefined, today), {
    totalMs: 0,
    totalWords: 0,
    streak: 0,
    lastReadAt: 0,
    readTodayMs: 0,
  });
});
