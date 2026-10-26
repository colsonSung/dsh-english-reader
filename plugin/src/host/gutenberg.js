/**
 * Host half of the online book source.
 *
 * The source is Project Gutenberg: the books are public domain, the catalogue
 * is the official machine readable CSV, and the files come from the official
 * download paths. The catalogue is large (about 21 MB), so the Host downloads
 * it once, keeps it in the private folder next to the MiniMax key, and
 * searches it in memory.
 *
 * Nothing here depends on the network being available at request time: once
 * the catalogue is cached, searching works offline.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** The official catalogue CSV. */
export const CATALOG_URL = 'https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv';

/** Where the catalogue is cached. */
export const CATALOG_FILE = join(homedir(), '.dsh', 'english-reader', 'gutenberg-catalog.csv');

/** How long a cached catalogue is considered fresh (seven days). */
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Wall-clock budget for one download. */
const DEFAULT_TIMEOUT_MS = 60000;

/** Rows of the catalogue that are kept in memory after a parse. */
let cachedRows = null;

/**
 * Split one CSV line into its fields, honouring the quoted form.
 * @param {string} line - the CSV line.
 * @returns {string[]} the fields.
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}

/**
 * Parse the catalogue CSV into the rows the search uses.
 *
 * The file is read as one string and split on the line breaks that are not
 * inside a quoted field; a title may span several lines.
 *
 * @param {string} text - the catalogue.
 * @returns {{id: number, title: string, author: string, language: string, subjects: string, bookshelves: string}[]} the rows.
 */
export function parseCatalog(text) {
  const rows = [];
  let field = '';
  let fields = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      field += char;
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      field += char;
      continue;
    }
    if (char === ',') {
      fields.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      fields.push(field);
      field = '';
      const parsed = parseCsvLine(fields.join(','));
      const [id, , , title, language, author, subjects, , bookshelves] = parsed;
      const number = Number(id);
      if (Number.isFinite(number) && String(title ?? '').trim() !== '') {
        rows.push({
          id: number,
          title: String(title).replace(/\s+/g, ' ').trim(),
          author: String(author ?? '').replace(/\s+/g, ' ').trim(),
          language: String(language ?? '').trim(),
          subjects: String(subjects ?? '').split(';').map((part) => part.trim()).filter(Boolean).slice(0, 3),
          bookshelves: String(bookshelves ?? '').split(';').map((part) => part.trim()).filter(Boolean).slice(0, 2),
        });
      }
      fields = [];
      continue;
    }
    field += char;
  }
  // The last line of the file has no line break after it.
  if (field !== '' || fields.length > 0) {
    fields.push(field);
    const parsed = parseCsvLine(fields.join(','));
    const [id, , , title, language, author, subjects, , bookshelves] = parsed;
    const number = Number(id);
    if (Number.isFinite(number) && String(title ?? '').trim() !== '') {
      rows.push({
        id: number,
        title: String(title).replace(/\s+/g, ' ').trim(),
        author: String(author ?? '').replace(/\s+/g, ' ').trim(),
        language: String(language ?? '').trim(),
        subjects: String(subjects ?? '').split(';').map((part) => part.trim()).filter(Boolean).slice(0, 3),
        bookshelves: String(bookshelves ?? '').split(';').map((part) => part.trim()).filter(Boolean).slice(0, 2),
      });
    }
  }
  return rows;
}

/**
 * Whether the cached catalogue is still fresh.
 * @param {string} [file] - the catalogue file.
 * @returns {boolean} true when the file exists and is younger than the TTL.
 */
export function isFresh(file = CATALOG_FILE) {
  try {
    if (!existsSync(file)) return false;
    return Date.now() - statSync(file).mtimeMs < CATALOG_TTL_MS;
  } catch {
    return false;
  }
}



/**
 * Fetch a file in ranges.
 *
 * The connection to the archive is cut from time to time, so every file is
 * fetched in ranges and each range is retried before the download is given up
 * on. The result is the whole file.
 *
 * @param {string} url - the file URL.
 * @param {object} [deps] - the injected dependencies.
 * @returns {Promise<Buffer>} the file.
 */
async function fetchWithRanges(url, deps = {}) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const chunkSize = 2 * 1024 * 1024;
  // The fast path: one plain request. The archive is quick most of the time.
  try {
    const response = await doFetch(url);
    if (response.ok) {
      const whole = Buffer.from(await response.arrayBuffer());
      if (whole.length > 0) return whole;
    }
  } catch {
    // The connection was cut; the ranged path below picks it up.
  }
  const head = await doFetch(url, { method: 'HEAD' });
  const total = Number(head.headers?.get?.('content-length') ?? 0);
  if (!head.ok || !Number.isFinite(total) || total <= 0) {
    const response = await doFetch(url);
    if (!response.ok) {
      const error = new Error(`下载失败（HTTP ${response.status}）`);
      error.code = 'DOWNLOAD_FAILED';
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  }
  const parts = [];
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(total - 1, start + chunkSize - 1);
    let buffer = null;
    for (let attempt = 0; attempt < 4 && buffer === null; attempt += 1) {
      try {
        const response = await doFetch(url, { headers: { range: `bytes=${start}-${end}` } });
        if (!response.ok) continue;
        buffer = Buffer.from(await response.arrayBuffer());
      } catch {
        buffer = null;
      }
    }
    if (buffer === null) {
      const error = new Error('下载中断，请稍后重试');
      error.code = 'DOWNLOAD_FAILED';
      throw error;
    }
    parts.push(buffer);
  }
  return Buffer.concat(parts);
}

/**
 * Download the catalogue in chunks.
 *
 * The file is large and the connection is cut from time to time, so it is
 * fetched in ranges and every chunk is retried once before giving up.
 *
 * @param {object} [deps] - the injected dependencies.
 * @returns {Promise<string>} the catalogue.
 */
async function downloadCatalog(deps = {}) {
  try {
    return (await fetchWithRanges(CATALOG_URL, deps)).toString('utf8');
  } catch (error) {
    error.code = 'CATALOG_UNAVAILABLE';
    error.message = `无法获取在线书库目录：${error.message}`;
    throw error;
  }
}

/**
 * Make sure the catalogue is on disk and parsed.
 *
 * @param {object} [deps] - the injected dependencies.
 * @param {Function} [deps.fetch] - the fetch implementation.
 * @param {string} [deps.file] - the catalogue file.
 * @returns {Promise<{rows: object[], count: number}>} the catalogue.
 */
export async function ensureCatalog(deps = {}) {
  // The caller may hand the rows over directly; the tests do that.
  if (Array.isArray(deps.rows)) {
    return { rows: deps.rows, count: deps.rows.length };
  }
  if (cachedRows !== null && deps.file === undefined) {
    return { rows: cachedRows, count: cachedRows.length };
  }
  const file = deps.file ?? CATALOG_FILE;
  let text = '';
  if (isFresh(file)) {
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      text = '';
    }
  }
  if (text === '') {
    text = await downloadCatalog(deps);
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    } catch {
      // A read-only home is fine: the catalogue is then kept in memory only.
    }
  }
  const rows = parseCatalog(text);
  cachedRows = rows;
  return { rows, count: rows.length };
}

/**
 * Search the catalogue.
 *
 * @param {object} options - the search parameters.
 * @param {string} options.query - the search text.
 * @param {number} [options.limit] - the number of hits.
 * @param {string} [options.language] - the language filter.
 * @param {object} [deps] - the injected dependencies.
 * @returns {Promise<object[]>} the hits.
 */
export async function search({ query, limit = 30, language = 'en' }, deps = {}) {
  const { rows } = await ensureCatalog(deps);
  const needle = String(query ?? '').trim().toLowerCase();
  const hits = [];
  for (const row of rows) {
    if (language !== '' && row.language !== language) continue;
    if (needle === '') {
      hits.push(row);
      continue;
    }
    const title = row.title.toLowerCase();
    const author = row.author.toLowerCase();
    if (title.includes(needle) || author.includes(needle)) hits.push(row);
  }
  // The title matches come first, then the author matches.
  hits.sort((a, b) => {
    const aTitle = a.title.toLowerCase().includes(needle) ? 0 : 1;
    const bTitle = b.title.toLowerCase().includes(needle) ? 0 : 1;
    if (aTitle !== bTitle) return aTitle - bTitle;
    return a.id - b.id;
  });
  return hits.slice(0, Math.max(1, Math.min(100, limit)));
}

/**
 * The download paths of one book.
 *
 * @param {number} id - the Gutenberg book id.
 * @returns {{epub: string, text: string, cover: string}} the URLs.
 */
export function downloadUrls(id) {
  const number = Number(id);
  return {
    epub: `https://www.gutenberg.org/cache/epub/${number}/pg${number}.epub`,
    text: `https://www.gutenberg.org/files/${number}/${number}-0.txt`,
    cover: `https://www.gutenberg.org/cache/epub/${number}/pg${number}.jpg`,
  };
}

/**
 * Download one book.
 *
 * @param {object} options - the download parameters.
 * @param {number} options.id - the Gutenberg book id.
 * @param {'epub'|'text'} [options.format] - the file format.
 * @param {object} [deps] - the injected dependencies.
 * @returns {Promise<{bytes: Uint8Array, contentType: string, url: string}>} the file.
 */
export async function download({ id, format = 'epub' }, deps = {}) {
  const urls = downloadUrls(id);
  const url = format === 'text' ? urls.text : urls.epub;
  const buffer = await fetchWithRanges(url, deps);
  return {
    bytes: new Uint8Array(buffer),
    contentType: format === 'text' ? 'text/plain; charset=utf-8' : 'application/epub+zip',
    url,
  };
}

/**
 * The cover image URL of one book.
 *
 * @param {number} id - the Gutenberg book id.
 * @returns {string} the URL.
 */
export function coverUrl(id) {
  return downloadUrls(id).cover;
}
