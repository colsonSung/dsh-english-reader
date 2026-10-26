/**
 * Parsing layer entry point.
 *
 * Turns an imported file into the intermediate structure the engine consumes:
 *
 *   ParsedBook = { title, author, format, chapters: [{ title, paragraphs }] }
 *
 * The dispatch is by file extension, with the MIME type as a fallback for
 * files that arrive without a name.
 */

import { parseEpub } from './epub.js';
import { parseHtml, parseMarkdown, parseTxt } from './plain.js';
import { parsePdf } from './pdf.js';
import { fileExtension, fileMimeType, fileTitle, readAsBytes } from './source.js';

export const SUPPORTED_EXTENSIONS = ['epub', 'txt', 'md', 'markdown', 'html', 'htm', 'pdf'];

export const SUPPORTED_ACCEPT = '.epub,.txt,.md,.markdown,.html,.htm,.pdf';

/** MIME types mapped onto the internal format names. */
const MIME_FORMATS = {
  'application/epub+zip': 'epub',
  'application/xhtml+xml': 'html',
  'application/pdf': 'pdf',
  'text/html': 'html',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/x-markdown': 'md',
};

/**
 * Decide which parser handles the file.
 * @param {any} file
 * @returns {string} one of the ParsedBook format names
 */
function resolveFormat(file) {
  const extension = fileExtension(file);
  if (SUPPORTED_EXTENSIONS.includes(extension)) {
    return extension === 'markdown' ? 'md' : extension === 'htm' ? 'html' : extension;
  }
  const mime = fileMimeType(file).split(';')[0].trim();
  const fromMime = MIME_FORMATS[mime];
  if (fromMime) return fromMime;
  throw new Error(
    `不支持的文件格式${extension ? `「.${extension}」` : ''}，请选择 EPUB、TXT、Markdown、HTML 或 PDF 文件`,
  );
}

/**
 * Parse a book into chapters and paragraphs.
 *
 * @param {any} file - a browser `File`/`Blob` with a name and a type
 * @returns {Promise<{ title: string, author: string, format: string, chapters: object[] }>}
 */
/**
 * The paragraphs a public domain file carries around its text: the licence
 * notice of the archive it came from. A reader never wants to read it, so it
 * is dropped when the book is imported.
 */
const FRONT_MATTER = /^(?:Title|Author|Release date|Language|Credits|Other information and formats|Produced by|Editor|Transcriber|Corrections|Notes)\s*:/i;
const BOILERPLATE_MARK = /^\*{0,3}\s*(?:START|END) OF THE PROJECT GUTENBERG/i;
const BOILERPLATE_TEXT = /This eBook is for the use of anyone anywhere in the United States|Copyright laws are changing all over the world, and not all of them are the same in every country|The rest of this ebook is available free at Project Gutenberg|Updated editions will replace the previous one|the old editions will be renamed|Certain state laws may require the use of different procedures for the establishment or distribution of a work of the U\.S\. copyright/i;

/**
 * Drop the licence paragraphs of a parsed book.
 *
 * @param {{paragraphs: {text: string}[]}[]} chapters - the chapters.
 * @returns {{paragraphs: {text: string}[]}[]} the chapters without the licence.
 */
export function stripBoilerplate(chapters) {
  // The licence may sit inside a block that also carries the heading, so the
  // sentences are looked for anywhere in the paragraph.
  const textOf = (paragraph) => String(typeof paragraph === 'string' ? paragraph : paragraph?.text ?? '').trim();
  const isBoilerplate = (paragraph) => {
    const value = textOf(paragraph);
    return BOILERPLATE_MARK.test(value) || BOILERPLATE_TEXT.test(value);
  };
  // The title page of a public domain file lists the book facts; those lines
  // are only dropped while the book has not started yet.
  let inFrontMatter = true;
  return (chapters ?? []).map((chapter) => ({
    ...chapter,
    paragraphs: (chapter.paragraphs ?? []).filter((paragraph) => {
      if (isBoilerplate(paragraph)) return false;
      const value = textOf(paragraph);
      if (inFrontMatter && FRONT_MATTER.test(value)) return false;
      if (value !== '') inFrontMatter = false;
      return true;
    }),
  }));
}

export async function parseBook(file) {
  if (!file) {
    throw new Error('没有选择文件');
  }
  const format = resolveFormat(file);

  let book;
  switch (format) {
    case 'epub':
      book = await parseEpub(file);
      break;
    case 'txt':
      book = await parseTxt(file);
      break;
    case 'md':
      book = await parseMarkdown(file);
      break;
    case 'html':
      book = await parseHtml(file);
      break;
    case 'pdf':
      book = await parsePdf(await readAsBytes(file));
      break;
    default:
      throw new Error(`不支持的文件格式「${format}」，请选择 EPUB、TXT、Markdown、HTML 或 PDF 文件`);
  }

  const chapters = book.chapters ?? [];
  const hasContent = chapters.some((chapter) => (chapter.paragraphs ?? []).length > 0);
  if (!hasContent) {
    throw new Error('未能从文件中解析出正文内容，请检查文件是否为空或已损坏');
  }

  return {
    title: book.title || fileTitle(file),
    author: book.author || '',
    format: book.format ?? format,
    // 公版书常带一段授权声明，对读者没有意义，导入时去掉
    chapters: stripBoilerplate(chapters),
    // The EPUB parser may hand back the cover image; other formats have none.
    cover: book.cover ?? null,
  };
}

export { parseEpub } from './epub.js';
export { parseHtml, parseMarkdown, parseTxt } from './plain.js';
export { parsePdf } from './pdf.js';
