/**
 * 比对层：打字逐字比对、朗读词级对齐、语速统计。
 *
 * 纯 ESM，不依赖 React，不依赖 DOM。依赖 segment.js 的 tokenize，保证
 * 「引擎切词」与「比对切词」是同一套规则。
 */

import { tokenize } from './segment.js';

/**
 * 把字符转成可比形式：小写 + 直引号化。
 *
 * @param {string} ch
 * @returns {string}
 */
function comparableChar(ch) {
  if (ch === '’' || ch === '‘') return "'";
  if (ch === '“' || ch === '”') return '"';
  return ch.toLowerCase();
}

/**
 * 词级比对：判断 typed 是否已经「覆盖」target。
 *
 * 采用词粒度（忽略标点与大小写）判定：
 * typed 的词序列必须至少与 target 的词序列逐词相同（可以有多余的词）。
 *
 * @param {string} target
 * @param {string} typed
 * @returns {boolean}
 */
function coversTarget(target, typed) {
  const targetWords = tokenize(target).map((w) => w.clean).filter(Boolean);
  if (targetWords.length === 0) return false;
  const typedWords = tokenize(typed).map((w) => w.clean).filter(Boolean);
  if (typedWords.length < targetWords.length) return false;
  for (let i = 0; i < targetWords.length; i += 1) {
    if (typedWords[i] !== targetWords[i]) return false;
  }
  return true;
}

/**
 * 打字比对：逐字符判定。
 *
 * `chars` 与 target 等长（逐个 target 字符），`ok` 表示该字符是否已经被正确键入；
 * 用户多打的字符不体现在 chars 里，但会计入 typedChars，从而拉低 accuracy。
 *
 * 索引基准是 UTF-16 码元，和 tokenize() 的 word.start / word.end 偏移严格一致，
 * 所以 UI 可以直接用 `diff.chars[word.start]` 判断某个词是否打对。
 *
 * @param {string} target - 原句
 * @param {string} typed - 用户已输入
 * @returns {{ chars: { ch: string, ok: boolean }[], typedChars: number, correctChars: number,
 *            accuracy: number, complete: boolean }}
 *   complete = typed 的规范化形式已覆盖 target 的规范化形式
 *   accuracy = correctChars / max(typedChars, 1)，取值 0..1
 */
export function diffTyping(target, typed) {
  const targetText = typeof target === 'string' ? target : '';
  const typedText = typeof typed === 'string' ? typed : '';

  // 逐字符对齐，索引基准是 UTF-16 码元 —— 与 tokenize 的 start/end 偏移完全一致，
  // 因此 UI 可以直接用 diff.chars[word.start] 取某个词的打字状态。
  const chars = [];
  for (let index = 0; index < targetText.length; index += 1) {
    const ch = targetText[index];
    const typedCh = index < typedText.length ? typedText[index] : undefined;
    chars.push({
      ch,
      ok: typedCh !== undefined && comparableChar(ch) === comparableChar(typedCh),
    });
  }

  const correctChars = chars.reduce((sum, item) => sum + (item.ok ? 1 : 0), 0);
  const typedCharsCount = typedText.length;
  const rawAccuracy = correctChars / Math.max(typedCharsCount, 1);
  const accuracy = Math.min(1, Math.max(0, Number.isFinite(rawAccuracy) ? rawAccuracy : 0));

  return {
    chars,
    typedChars: typedCharsCount,
    correctChars,
    accuracy,
    complete: coversTarget(targetText, typedText),
  };
}

/**
 * 词级对齐（Levenshtein 回溯），返回对齐动作序列。
 *
 * @param {string[]} a 目标词
 * @param {string[]} b 识别到的词
 * @returns {{ type: 'match'|'sub'|'del'|'ins', t: number, s: number }[]}
 */
function alignWords(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = [];
  for (let i = 0; i <= n; i += 1) dp.push(new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) dp[i][m] = n - i;
  for (let j = 0; j <= m; j += 1) dp[n][j] = m - j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1]
        : 1 + Math.min(dp[i + 1][j], dp[i][j + 1], dp[i + 1][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'match', t: i, s: j });
      i += 1;
      j += 1;
    } else if (dp[i][j] === dp[i + 1][j + 1] + 1) {
      ops.push({ type: 'sub', t: i, s: j });
      i += 1;
      j += 1;
    } else if (dp[i][j] === dp[i + 1][j] + 1) {
      ops.push({ type: 'del', t: i });
      i += 1;
    } else {
      ops.push({ type: 'ins', s: j });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', t: i });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: 'ins', s: j });
    j += 1;
  }
  return ops;
}

/**
 * 朗读比对：词级对齐。
 *
 * 以 target 的词为基准做编辑距离对齐；target 有而 spoken 缺 → 'missing'；
 * spoken 多出来的词 → 'extra'（放在末尾）；词形不一致 → 'wrong'。
 *
 * @param {string} target - 原句
 * @param {string} spoken - 识别到（或用户自述）的文本
 * @returns {{ words: { word: string, status: 'ok'|'wrong'|'missing'|'extra' }[],
 *            accuracy: number, missing: number, extra: number, matched: number }}
 */
export function diffWords(target, spoken) {
  const targetWords = tokenize(typeof target === 'string' ? target : '')
    .map((w) => w.clean)
    .filter(Boolean);
  const spokenWords = tokenize(typeof spoken === 'string' ? spoken : '')
    .map((w) => w.clean)
    .filter(Boolean);

  const ops = alignWords(targetWords, spokenWords);
  /** @type {{ word: string, status: 'ok'|'wrong'|'missing'|'extra' }[]} */
  const words = [];
  /** @type {string[]} */
  const extras = [];
  let matched = 0;
  let missing = 0;

  for (const op of ops) {
    if (op.type === 'match') {
      words.push({ word: targetWords[op.t], status: 'ok' });
      matched += 1;
    } else if (op.type === 'sub') {
      words.push({ word: targetWords[op.t], status: 'wrong' });
    } else if (op.type === 'del') {
      words.push({ word: targetWords[op.t], status: 'missing' });
      missing += 1;
    } else if (op.type === 'ins') {
      extras.push(spokenWords[op.s]);
    }
  }
  for (const word of extras) words.push({ word, status: 'extra' });

  const accuracy = targetWords.length === 0
    ? (spokenWords.length === 0 ? 1 : 0)
    : matched / targetWords.length;

  return {
    words,
    accuracy: Math.min(1, Math.max(0, accuracy)),
    missing,
    extra: extras.length,
    matched,
  };
}

/**
 * 语速。
 *
 * @param {number} chars - 输入字符数
 * @param {number} ms - 耗时毫秒
 * @returns {number} 每分钟词数（按 5 字符≈1 词折算）
 */
export function wordsPerMinute(chars, ms) {
  const charCount = Number(chars);
  const duration = Number(ms);
  if (!Number.isFinite(charCount) || !Number.isFinite(duration)) return 0;
  if (charCount <= 0 || duration <= 0) return 0;
  return (charCount / 5) / (duration / 60000);
}
