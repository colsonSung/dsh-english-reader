/**
 * 一本书内部的词频。
 *
 * 阅读器已经知道怎么切词，所以这里复用同一个切词器：把一本书的章节切成词，
 * 统计词频，返回最高的那一批。
 *
 * 中文按「一字一词」统计：没有中文分词器时，单字就是诚实的单位。
 */
import { tokenize } from './engine/segment.js';

/** 对学习者没有意义、只会占位子的词。 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'at', 'by', 'for', 'with',
  'to', 'from', 'in', 'on', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'it', 'its', 'this', 'that', 'these', 'those', 'he', 'she', 'they', 'them',
  'his', 'her', 'their', 'i', 'you', 'we', 'us', 'my', 'your', 'our', 'as',
  'so', 'not', 'no', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would',
  'can', 'could', 'should', 'may', 'might', 'there', 'here', 'what', 'which',
  'who', 'when', 'where', 'how', 'all', 'any', 'some', 'more', 'most', 'other',
  'such', 'than', 'then', 'too', 'very', 's', 't', 'don', 'now',
]);

/**
 * 一本书里出现最多的词。
 *
 * @param {{ title: string, paragraphs: string[] }[]} chapters - 书的章节。
 * @param {number} [limit] - 最多返回多少个词。
 * @param {{ stopWords?: boolean }} [options] - 是否去掉功能词。
 * @returns {{ word: string, count: number, share: number }[]} 按词频从高到低。
 */
export function wordFrequency(chapters, limit = 40, options = {}) {
  const counts = new Map();
  let total = 0;
  for (const chapter of chapters ?? []) {
    for (const paragraph of chapter?.paragraphs ?? []) {
      for (const word of tokenize(String(paragraph ?? ''))) {
        const clean = word.clean;
        if (clean.length === 0) continue;
        if (options.stopWords !== false && STOP_WORDS.has(clean)) continue;
        if (!/[\p{L}\p{N}]/u.test(clean)) continue;
        counts.set(clean, (counts.get(clean) ?? 0) + 1);
        total += 1;
      }
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count, share: total === 0 ? 0 : count / total }))
    .sort((a, b) => (b.count - a.count) || a.word.localeCompare(b.word))
    .slice(0, limit);
}

/**
 * 一本书有多大（按词算）。
 *
 * 英文按空格分开的词算，中文按汉字算——中文没有词间空格，逐字计数
 * 是唯一诚实的口径。
 *
 * @param {{ title: string, paragraphs: string[] }[]} chapters - 书的章节。
 * @returns {number} 全书的词数。
 */
export function bookWordCount(chapters) {
  let total = 0;
  for (const chapter of chapters ?? []) {
    for (const paragraph of chapter?.paragraphs ?? []) {
      total += tokenize(String(paragraph ?? '')).length;
    }
  }
  return total;
}
