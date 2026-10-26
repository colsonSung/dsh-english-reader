/**
 * Reading activity per book.
 *
 * The shelf shows how much a learner read: the time spent, the words read and
 * the streak of consecutive reading days. Every function here is pure — it
 * takes an activity and returns a new one — so the reader page, the shelf grid
 * and the tests all work on the same numbers without any shared state.
 *
 * A day is a *local* calendar day (`YYYY-MM-DD`): a streak has to line up with
 * the learner's own midnight, not with UTC.
 */

/**
 * @typedef {object} Activity
 * @property {number} totalMs        // 累计阅读毫秒
 * @property {number} totalWords     // 累计已读词数
 * @property {number} lastReadAt     // 上次阅读时间戳
 * @property {number} startedAt      // 首次打开时间戳
 * @property {Record<string, number>} days  // 'YYYY-MM-DD' -> 当天阅读毫秒
 */

/**
 * An activity without any reading yet.
 * @returns {Activity}
 */
export function emptyActivity() {
  return {
    totalMs: 0,
    totalWords: 0,
    lastReadAt: 0,
    startedAt: 0,
    days: {},
  };
}

/**
 * The local calendar day of a timestamp, as `YYYY-MM-DD`.
 * @param {number} [timestamp]
 * @returns {string} '' when the timestamp is not a valid date
 */
export function localDayKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The day key a number of days before (or after) another one.
 * @param {string} key
 * @param {number} delta
 * @returns {string}
 */
function shiftDayKey(key, delta) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // The Date constructor reads local midnight, so a day is a calendar day and
  // not a fixed number of milliseconds — daylight saving cannot shift it.
  const shifted = new Date(year, month - 1, day + delta);
  if (year < 100) shifted.setFullYear(year);
  return localDayKey(shifted.getTime());
}

/**
 * @param {unknown} value
 * @returns {number} the value, or 0 when it is not a usable number
 */
function toCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number;
}

/**
 * Whether a day holds any reading.
 * @param {Record<string, number>} days
 * @param {string} key
 * @returns {boolean}
 */
function hasReading(days, key) {
  if (!key) return false;
  return toCount(days?.[key]) > 0;
}

/**
 * Record a stretch of reading.
 *
 * @param {Activity | undefined} activity - the activity so far
 * @param {{ ms?: number, words?: number, now?: number }} input
 * @returns {Activity} a new activity; the argument is never modified
 */
export function recordReading(activity, input = {}) {
  const base = activity && typeof activity === 'object' ? activity : emptyActivity();
  const ms = toCount(input?.ms);
  const words = toCount(input?.words);
  const now = Number.isFinite(Number(input?.now)) ? Number(input.now) : Date.now();

  const days = { ...(base.days ?? {}) };
  const key = localDayKey(now);
  if (key) days[key] = toCount(days[key]) + ms;

  return {
    ...base,
    totalMs: toCount(base.totalMs) + ms,
    totalWords: toCount(base.totalWords) + words,
    lastReadAt: Math.max(toCount(base.lastReadAt), now),
    startedAt: toCount(base.startedAt) || now,
    days,
  };
}

/**
 * The number of consecutive days the learner read.
 *
 * Today counts when there was reading today; otherwise the streak continues
 * from yesterday. A day without reading ends the streak.
 *
 * @param {Activity | undefined} activity
 * @param {number} [now]
 * @returns {number}
 */
export function readingStreak(activity, now = Date.now()) {
  const days = activity?.days ?? {};
  let cursor = localDayKey(now);
  if (!cursor) return 0;
  if (!hasReading(days, cursor)) {
    cursor = shiftDayKey(cursor, -1);
    if (!hasReading(days, cursor)) return 0;
  }
  let streak = 0;
  while (hasReading(days, cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
    if (!cursor) break;
  }
  return streak;
}

/**
 * The numbers the shelf grid shows next to a book.
 *
 * @param {Activity | undefined} activity
 * @param {number} [now]
 * @returns {{ totalMs: number, totalWords: number, streak: number, lastReadAt: number, readTodayMs: number }}
 */
export function summarizeActivity(activity, now = Date.now()) {
  const days = activity?.days ?? {};
  const key = localDayKey(now);
  return {
    totalMs: toCount(activity?.totalMs),
    totalWords: toCount(activity?.totalWords),
    streak: readingStreak(activity, now),
    lastReadAt: toCount(activity?.lastReadAt),
    readTodayMs: toCount(days[key]),
  };
}
