/**
 * PDF parser.
 *
 * pdf.js is far too large to sit in the main bundle, so it is loaded on demand
 * through the shared chunk loader. The parsing layer never imports pdf.js
 * directly — that keeps the main bundle small and lets the parser degrade with
 * a clear message when the chunk cannot be fetched.
 *
 * The extraction is best-effort: a PDF is a drawing instruction stream, not a
 * document model, so text is reassembled from positioned glyph runs.
 */

import { loadChunk } from '../chunks.js';

/** Shown whenever pdf.js cannot be used at all. */
const UNAVAILABLE_MESSAGE = '「PDF 解析暂不可用，请改用 EPUB 或 TXT」';

/** Minimum vertical distance that still counts as the same text line. */
const SAME_LINE_TOLERANCE = 1.5;

/**
 * @param {any} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return String(error);
}

/**
 * Locate `getDocument` in the chunk namespace.
 * @param {any} pdfjs
 * @returns {((options: any) => any) | null}
 */
function resolveGetDocument(pdfjs) {
  if (!pdfjs) return null;
  if (typeof pdfjs.getDocument === 'function') return pdfjs.getDocument;
  if (pdfjs.default && typeof pdfjs.default.getDocument === 'function') {
    return pdfjs.default.getDocument.bind(pdfjs.default);
  }
  if (typeof pdfjs.default === 'function') return pdfjs.default;
  return null;
}

/**
 * Merge the text items of a page into lines.
 *
 * pdf.js marks the end of a line with `hasEOL`, but only when the text was
 * produced with line breaks; many generators omit it, so a change of the
 * baseline coordinate is used as a second signal.
 *
 * @param {any[]} items
 * @returns {{ text: string, y: number | null }[]}
 */
export function itemsToLines(items) {
  const lines = [];
  let text = '';
  let y = null;

  const flush = () => {
    lines.push({ text: text.trim(), y });
    text = '';
    y = null;
  };

  for (const item of items ?? []) {
    const value = typeof item?.str === 'string' ? item.str : '';
    const transform = item?.transform;
    const baseline = Array.isArray(transform) ? transform[5] : null;
    if (baseline != null && y != null && Math.abs(baseline - y) > SAME_LINE_TOLERANCE) {
      flush();
    }
    text += value;
    if (baseline != null) y = baseline;
    if (item?.hasEOL) flush();
  }
  if (text.trim()) flush();
  return lines;
}

/**
 * @param {{ text: string, y: number | null }[]} lines
 * @returns {number} the typical distance between two lines
 */
function estimateLineSpacing(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i += 1) {
    const previous = lines[i - 1];
    const current = lines[i];
    if (previous.y == null || current.y == null) continue;
    const gap = Math.abs(previous.y - current.y);
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 12;
  // The smallest usable gap is the line height; the median would be skewed by
  // the very gaps (paragraph breaks) we are trying to detect.
  const usable = gaps.filter((gap) => gap >= 4);
  const pool = usable.length ? usable : gaps;
  let spacing = pool[0];
  for (const gap of pool) {
    if (gap < spacing) spacing = gap;
  }
  return spacing;
}

/**
 * Join two lines of a paragraph.
 *
 * A word broken by a hyphen at the end of a line has to be glued back
 * together, otherwise the reader would say "exam" and "ple" as two words.
 *
 * @param {string} previous
 * @param {string} next
 * @returns {string}
 */
function joinLines(previous, next) {
  if (/[A-Za-z]-$/.test(previous) && /^[a-z]/.test(next)) {
    return `${previous.slice(0, -1)}${next}`;
  }
  return `${previous} ${next}`;
}

/**
 * Group lines into paragraphs using blank lines and vertical gaps.
 * @param {{ text: string, y: number | null }[]} lines
 * @returns {string[]}
 */
export function linesToParagraphs(lines) {
  const spacing = estimateLineSpacing(lines);
  const gapLimit = Math.min(Math.max(spacing * 1.6, spacing + 3), spacing * 4);
  const paragraphs = [];
  let buffer = '';
  let previous = null;

  for (const line of lines) {
    if (!line.text) {
      if (buffer) {
        paragraphs.push(buffer);
        buffer = '';
      }
      previous = null;
      continue;
    }
    if (previous && previous.y != null && line.y != null) {
      if (Math.abs(previous.y - line.y) > gapLimit && buffer) {
        paragraphs.push(buffer);
        buffer = '';
      }
    }
    buffer = buffer ? joinLines(buffer, line.text) : line.text;
    previous = line;
  }
  if (buffer) paragraphs.push(buffer);
  return paragraphs;
}

/**
 * Parse a PDF into one chapter per page.
 *
 * A PDF is walked page by page, so the parser can say how far it is: the
 * progress callback receives `{ ratio, current, total, unit: 'page' }` after
 * every page.
 *
 * @param {ArrayBuffer | Uint8Array} arrayBuffer
 * @param {{ loadChunk?: (path: string) => Promise<any>, onProgress?: Function }} [options]
 * @returns {Promise<{ title: string, author: string, format: string, chapters: object[] }>}
 */
export async function parsePdf(arrayBuffer, options = {}) {
  const loader = options.loadChunk ?? loadChunk;
  const report = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  let pdfjs;
  try {
    pdfjs = await loader('./client.pdf.js');
  } catch {
    throw new Error(UNAVAILABLE_MESSAGE);
  }
  const getDocument = resolveGetDocument(pdfjs);
  if (!getDocument) {
    throw new Error(UNAVAILABLE_MESSAGE);
  }

  // pdf.js insists on a plain Uint8Array: a Node `Buffer` is a Uint8Array
  // subclass and is rejected outright.
  const data = new Uint8Array(arrayBuffer ?? 0);

  let document;
  try {
    const task = getDocument({ data });
    document = await task.promise;
  } catch (error) {
    throw new Error(`PDF 解析失败：${errorMessage(error)}`);
  }
  if (!document) {
    throw new Error('PDF 解析失败：无法打开文档');
  }

  let title = '';
  let author = '';
  try {
    const metadata = await document.getMetadata?.();
    title = metadata?.info?.Title ?? '';
    author = metadata?.info?.Author ?? '';
  } catch {
    // Metadata is optional; a missing one must not fail the import.
  }

  const chapters = [];
  const pageCount = Number(document.numPages) || 0;
  report({ ratio: 0, current: 0, total: pageCount, unit: 'page' });
  for (let number = 1; number <= pageCount; number += 1) {
    let content;
    try {
      const page = await document.getPage(number);
      content = await page.getTextContent();
    } catch (error) {
      throw new Error(`PDF 解析失败：第 ${number} 页读取失败（${errorMessage(error)}）`);
    }
    chapters.push({
      title: `第 ${number} 页`,
      paragraphs: linesToParagraphs(itemsToLines(content?.items)),
    });
    report({ ratio: number / pageCount, current: number, total: pageCount, unit: 'page' });
  }

  const withText = chapters.filter((chapter) => chapter.paragraphs.length > 0);
  if (!withText.length) {
    throw new Error('PDF 中没有可提取的文字（可能是扫描件），请改用 EPUB 或 TXT');
  }

  return {
    title: title || '',
    author: author || '',
    format: 'pdf',
    chapters: withText,
  };
}
