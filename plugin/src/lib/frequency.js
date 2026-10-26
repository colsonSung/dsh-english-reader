/**
 * Word frequency inside one book.
 *
 * The reader already knows how to split text into words, so the same
 * tokenizer is reused here: a book's chapters are tokenized, the words are
 * counted, and the most frequent ones are returned.
 */
import { tokenize } from './engine/segment.js';

/** Words that carry no meaning for a learner and would only pad the list. */
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
 * The most frequent words of a book.
 * @param {{ title: string, paragraphs: string[] }[]} chapters
 * @param {number} [limit] - how many words to return
 * @param {{ stopWords?: boolean }} [options] - drop the function words
 * @returns {{ word: string, count: number, share: number }[]} most frequent first
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
 * The size of a book in words.
 * @param {{ title: string, paragraphs: string[] }[]} chapters
 * @returns {number}
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
