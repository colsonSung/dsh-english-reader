/**
 * Plain-text parsers: TXT, Markdown and HTML.
 *
 * All three end up in the same intermediate shape the engine expects — a list of
 * chapters, each holding natural paragraphs. The differences are only in how
 * the raw text is split into those paragraphs.
 */

import {
  collapseWhitespace,
  extractParagraphs,
  findElements,
  parseHtmlDocument,
} from './dom.js';
import { fileTitle, readAsText } from './source.js';

/** A single line longer than this cannot be read as one paragraph. */
const LONG_LINE_LIMIT = 2000;

/**
 * Split a blob of text into paragraphs on blank lines.
 * @param {string} text
 * @returns {string[]}
 */
export function splitOnBlankLines(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((block) => collapseWhitespace(block))
    .filter(Boolean);
}

/**
 * Cut an over-long paragraph into readable pieces.
 *
 * A paragraph that came from a single very long line (minified HTML, a
 * machine-generated text) would otherwise reach the sentence splitter as one
 * enormous block. It is split at sentence boundaries, and a single sentence
 * that is still too long is cut at the character limit.
 *
 * @param {string} paragraph
 * @returns {string[]}
 */
export function splitLongParagraph(paragraph) {
  if (paragraph.length <= LONG_LINE_LIMIT) return [paragraph];
  const sentences = paragraph.match(/[^.!?]*[.!?]+(?:["')\]]+)?\s*|[^.!?]+$/g);
  const pieces = [];
  let current = '';
  for (const sentence of sentences ?? []) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (current && current.length + trimmed.length > LONG_LINE_LIMIT) {
      pieces.push(current);
      current = '';
    }
    current += trimmed;
    if (current.length > LONG_LINE_LIMIT) {
      pieces.push(current.slice(0, LONG_LINE_LIMIT));
      current = current.slice(LONG_LINE_LIMIT);
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.length ? pieces : [paragraph];
}

/**
 * Parse a plain text book.
 * @param {any} file
 * @returns {Promise<{ title: string, author: string, format: string, chapters: object[] }>}
 */
export async function parseTxt(file) {
  const text = await readAsText(file);
  const paragraphs = splitOnBlankLines(text).flatMap(splitLongParagraph);
  const title = fileTitle(file);
  return {
    title,
    author: '',
    format: 'txt',
    chapters: [{ title, paragraphs }],
  };
}

/**
 * Remove the inline markers of Markdown so that only the readable text is left.
 * @param {string} line
 * @returns {string}
 */
function stripInlineMarkup(line) {
  let out = line;
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  out = out.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  // Underscores only count as emphasis when they wrap a word; `snake_case`
  // must survive untouched.
  out = out.replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1$2');
  out = out.replace(/~~([^~]+)~~/g, '$1');
  out = out.replace(/`([^`]+)`/g, '$1');
  return out;
}

/**
 * Strip the block markers of a single Markdown line.
 * @param {string} line
 * @returns {string}
 */
function stripBlockMarkup(line) {
  let out = line;
  out = out.replace(/^\s{0,3}#{1,6}\s+/, '');
  out = out.replace(/^\s{0,3}>\s?/, '');
  out = out.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
  return out;
}

/**
 * @param {string} line
 * @returns {boolean} true for a thematic break or a setext heading underline
 */
function isSeparatorLine(line) {
  return /^\s{0,3}([-*_]\s*){3,}$/.test(line);
}

/**
 * Parse a Markdown book.
 *
 * Fenced code blocks keep their content as a single paragraph (the caller
 * decides whether code should be read aloud); every other block loses its
 * Markdown markers before being split on blank lines.
 *
 * @param {any} file
 * @returns {Promise<{ title: string, author: string, format: string, chapters: object[] }>}
 */
export async function parseMarkdown(file) {
  const text = await readAsText(file);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraphLines = [];
  let codeLines = null;

  const flushParagraph = () => {
    if (paragraphLines.length) {
      blocks.push({ type: 'text', lines: paragraphLines });
      paragraphLines = [];
    }
  };

  for (const line of lines) {
    const fence = /^\s*(?:```|~~~)/.test(line);
    if (codeLines) {
      if (fence) {
        blocks.push({ type: 'code', lines: codeLines });
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (fence) {
      flushParagraph();
      codeLines = [];
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    if (isSeparatorLine(line)) {
      flushParagraph();
      continue;
    }
    paragraphLines.push(line);
  }
  if (codeLines) blocks.push({ type: 'code', lines: codeLines });
  flushParagraph();

  const paragraphs = [];
  for (const block of blocks) {
    if (block.type === 'code') {
      const content = block.lines.join('\n').trim();
      if (content) paragraphs.push(content);
      continue;
    }
    const cleaned = block.lines
      .map((line) => stripInlineMarkup(stripBlockMarkup(line)).trim())
      .filter(Boolean);
    const paragraph = collapseWhitespace(cleaned.join(' '));
    if (paragraph) paragraphs.push(paragraph);
  }

  const title = fileTitle(file);
  return {
    title,
    author: '',
    format: 'md',
    chapters: [{ title, paragraphs }],
  };
}

/**
 * Parse an HTML book.
 *
 * @param {any} file
 * @returns {Promise<{ title: string, author: string, format: string, chapters: object[] }>}
 */
export async function parseHtml(file) {
  const html = await readAsText(file);
  const doc = parseHtmlDocument(html);
  const root = doc.documentElement;
  const paragraphs = extractParagraphs(root);
  const titleElement = findElements(root, 'title')[0];
  const title = collapseWhitespace(titleElement?.textContent ?? '') || fileTitle(file);
  return {
    title,
    author: '',
    format: 'html',
    chapters: [{ title, paragraphs }],
  };
}
