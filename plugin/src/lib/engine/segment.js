/**
 * 文本切分层：规范化 → 切句 → 切词 → 展开成逐句单元。
 *
 * 纯 ESM，不依赖 React，不依赖 DOM（不使用任何浏览器专有 API）。
 * 所有函数都是纯函数：同样的输入永远得到同样的输出，方便 UI 侧做缓存与回放。
 */

/**
 * @typedef {object} Word
 * @property {string} text  原文片段（可能带尾部标点，例如 "don't,"）
 * @property {string} clean 去掉首尾标点并小写后的可比形式（例如 "don't"）
 * @property {number} start 在传入句子中的起始字符偏移
 * @property {number} end   在传入句子中的结束字符偏移（不含）
 */

/**
 * @typedef {object} Unit
 * @property {string} id
 * @property {number} chapterIndex
 * @property {string} chapterTitle
 * @property {number} paragraphIndex
 * @property {number} sentenceIndex 该段内第几句，从 0 开始
 * @property {string} text
 * @property {Word[]} words
 */

/** 常见缩写（比较前统一小写；不含结尾的句点）。 */
const ABBREVIATIONS = new Set([
  // 头衔 / 称谓
  'mr', 'mrs', 'ms', 'mx', 'miss', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'rev',
  'gen', 'col', 'capt', 'lt', 'sgt', 'hon', 'pres', 'gov', 'sen', 'rep', 'fr',
  'rabbi', 'msgr', 'supt', 'det', 'adm', 'maj', 'cmdr', 'brig',
  // 拉丁 / 学术 / 出版
  'etc', 'al', 'cf', 'viz', 'eg', 'ie', 'ibid', 'approx', 'dept', 'est', 'fig',
  'figs', 'vol', 'vols', 'chap', 'pp', 'misc',
  // 月份
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  // 其它
  'vs', 'u.s', 'u.k', 'u.s.a', 'ph.d', 'm.d', 'b.a', 'm.a', 'd.c', 'a.m', 'p.m',
  'e.g', 'i.e',
]);

/** 形如 "u.s" / "ph.d" / "e.g" 的点分缩写。 */
const DOTTED_INITIALS = /^(?:[a-z]\.)+[a-z]$/;

/** 序数词：1st / 2nd / 3rd / 4th。 */
const ORDINAL = /^\d+(?:st|nd|rd|th)$/i;

/** 词核心：字母或数字，允许词内撇号与连字符（如 don't、well-known）。 */
const WORD_CORE = /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g;

/** 可以并入词尾的标点（不含双引号，避免把下一段的引号吞进来）。 */
const TRAILING_PUNCTUATION = /[.,;:!?%…)\]}’']/;

/** 可以并入句尾的闭合符号。 */
const CLOSING_MARKS = '"\'”’)]}»›';

const DIGIT = /[0-9]/;
const LETTER = /[A-Za-z]/;
const UPPER_LETTER = /[A-Z]/;

function isSpace(ch) {
  return typeof ch === 'string' && ch !== '' && /\s/.test(ch);
}

function isDigit(ch) {
  return typeof ch === 'string' && DIGIT.test(ch);
}

function isUpperLetter(ch) {
  return typeof ch === 'string' && UPPER_LETTER.test(ch);
}

function skipSpaces(text, from) {
  let i = from;
  while (i < text.length && isSpace(text[i])) i += 1;
  return i;
}

/**
 * 规范化文本：弯引号→直引号、全角空格→半角、去掉软连字符、压缩空白。
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  let out = text;
  // 弯引号 → 直引号
  out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // 全角空格 / 不换行空格 → 半角空格
  out = out.replace(/[　 ]/g, ' ');
  // 软连字符（soft hyphen）
  out = out.replace(/­/g, '');
  // 换行断词：行尾连字符 + 换行 + 小写字母 → 直接连起来
  out = out.replace(/(\w)-[ \t]*\r?\n[ \t]*([a-z])/g, '$1$2');
  // 压缩空白
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * 判断 dot 位置上的句点是否属于缩写（Mr. / Dr. / e.g. / i.e. / etc. / U.S. …）。
 *
 * @param {string} text
 * @param {number} dotIndex 句点的下标
 * @returns {boolean}
 */
function isAbbreviation(text, dotIndex) {
  // 从句点往前收集一个「词」（允许内部含点，便于识别 U.S. / e.g.）
  let start = dotIndex;
  while (start > 0 && /[A-Za-z0-9.]/.test(text[start - 1])) start -= 1;
  const token = text.slice(start, dotIndex);
  if (!token) return false;
  const lower = token.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return true;
  if (DOTTED_INITIALS.test(lower)) return true;
  if (ORDINAL.test(token)) return true;
  // 单个首字母缩写，如 "J. Smith"
  if (token.length === 1 && UPPER_LETTER.test(token)) {
    const next = skipSpaces(text, dotIndex + 1);
    return next < text.length && LETTER.test(text[next]);
  }
  return false;
}

/**
 * 判断句点是否属于列表编号（"1. 第一条"）。只有当编号出现在行首时才成立，
 * 这样 "1990. 那一年" 这类正常句子仍会被切开。
 *
 * @param {string} text
 * @param {number} dotIndex
 * @returns {boolean}
 */
function isListMarker(text, dotIndex) {
  let start = dotIndex;
  while (start > 0 && isDigit(text[start - 1])) start -= 1;
  if (start === dotIndex) return false; // 前面没有数字
  let i = start - 1;
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i -= 1;
  return i < 0 || text[i] === '\n' || text[i] === '\r';
}

/**
 * 把紧跟在句尾的闭合符号并入句子（引号、括号等）。
 *
 * @param {string} text
 * @param {number} from
 * @returns {number} 并入后的结束下标（不含）
 */
function absorbClosing(text, from) {
  let i = from;
  while (i < text.length && CLOSING_MARKS.includes(text[i])) i += 1;
  return i;
}

/**
 * 计算以 text[terminatorIndex] 处的标点结尾的句子边界。
 *
 * @param {string} text
 * @param {number} terminatorIndex
 * @returns {number} 句子结束下标（不含）；不是句尾时返回 -1
 */
function findSentenceEnd(text, terminatorIndex) {
  const n = text.length;
  const ch = text[terminatorIndex];
  let j = terminatorIndex + 1;

  if (ch === '.') {
    let dots = 1;
    while (j < n && text[j] === '.') {
      dots += 1;
      j += 1;
    }
    if (dots >= 3) {
      // 省略号：后面跟空白 + 大写字母（或文本结束）才算句子结束
      const k = skipSpaces(text, j);
      if (k < n && !isUpperLetter(text[k])) return -1;
      return absorbClosing(text, j);
    }
    if (isAbbreviation(text, terminatorIndex)) return -1;
    if (isDigit(text[terminatorIndex - 1]) && isDigit(text[j])) return -1; // 3.14
    if (isListMarker(text, terminatorIndex)) return -1; // 1. 第一条
  } else {
    // 连续的 ! 或 ?（"Really?!"）
    while (j < n && (text[j] === '!' || text[j] === '?')) j += 1;
  }

  const end = absorbClosing(text, j);
  const after = text[end];
  if (after === undefined || isSpace(after)) return end;
  return -1;
}

/**
 * 切句。需处理句末标点 . ! ? 以及闭引号；需避免在常见缩写（Mr. Dr. e.g. i.e. etc. U.S.）后误切。
 *
 * @param {string} text
 * @returns {string[]} 每个元素是一个句子（含原标点），空白已 trim
 */
export function splitSentences(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const sentences = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      const end = findSentenceEnd(text, i);
      if (end > i) {
        const piece = text.slice(start, end).trim();
        if (piece) sentences.push(piece);
        start = end;
        i = end;
        continue;
      }
    }
    i += 1;
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

/**
 * 生成词的可比形式：去掉首尾标点、小写、直引号化。
 *
 * @param {string} text
 * @returns {string}
 */
function cleanWord(text) {
  let out = String(text).toLowerCase();
  out = out.replace(/[‘’]/g, "'");
  out = out.replace(/^[^\p{L}\p{N}]+/u, '');
  out = out.replace(/[^\p{L}\p{N}]+$/u, '');
  return out;
}

/**
 * 切词：保留原文片段与规范化形式。
 *
 * 偏移保证 `sentence.slice(word.start, word.end) === word.text`。
 *
 * @param {string} sentence
 * @returns {Word[]}
 */
export function tokenize(sentence) {
  if (typeof sentence !== 'string' || sentence.length === 0) return [];
  const words = [];
  const re = new RegExp(WORD_CORE.source, 'g');
  let match = re.exec(sentence);
  while (match !== null) {
    let end = match.index + match[0].length;
    // 把紧跟的尾部标点并入这个词（"don't," → "don't,"）
    while (end < sentence.length && TRAILING_PUNCTUATION.test(sentence[end])) end += 1;
    const text = sentence.slice(match.index, end);
    words.push({ text, clean: cleanWord(text), start: match.index, end });
    if (end > re.lastIndex) re.lastIndex = end;
    match = re.exec(sentence);
  }
  return words;
}

/**
 * 把章节展开成逐句单元。
 *
 * 段落先做规范化再切句，因此单元文本是干净的单行句子。
 *
 * @param {{ title?: string, paragraphs?: string[] }[]} chapters
 * @returns {Unit[]}
 */
export function buildUnits(chapters) {
  /** @type {Unit[]} */
  const units = [];
  const list = Array.isArray(chapters) ? chapters : [];
  list.forEach((chapter, chapterIndex) => {
    const chapterTitle = chapter && typeof chapter.title === 'string' ? chapter.title : '';
    const paragraphs =
      chapter && Array.isArray(chapter.paragraphs) ? chapter.paragraphs : [];
    paragraphs.forEach((paragraph, paragraphIndex) => {
      const normalized = normalizeText(typeof paragraph === 'string' ? paragraph : '');
      if (!normalized) return;
      const sentences = splitSentences(normalized);
      sentences.forEach((text, sentenceIndex) => {
        units.push({
          id: `c${chapterIndex}-p${paragraphIndex}-s${sentenceIndex}`,
          chapterIndex,
          chapterTitle,
          paragraphIndex,
          sentenceIndex,
          text,
          words: tokenize(text),
        });
      });
    });
  });
  return units;
}
