/**
 * The source file of a book: the EPUB, PDF or text file the learner imported.
 *
 * The shelf keeps the parsed text of every book, but the original file is a
 * different thing: it is what the learner owns, what a DRM-free reader should
 * be able to take away again, and the only way to see the book as it was
 * published. So the Host keeps the bytes next to the shelf
 * (`<shelf>/sources/<bookId>.<format>`) and this module is the client's half of
 * that channel:
 *
 *   - `uploadSourceFile` hands the original bytes to the Host right after an
 *     import, so the file survives a browser that is closed or replaced;
 *   - `fetchSourceFile` reads them back for the preview;
 *   - `downloadSourceFile` hands them to the browser as a download.
 *
 * The route is binary in both directions: the request body is the raw file and
 * the response is the raw file. Everything that is known about the file (its
 * name, its type, its format) travels in the query string, because a header
 * cannot carry a file name with Chinese characters in it.
 */

/** The route the Host registers for the source files. */
export const SOURCE_ROUTE = '/api/reader/source';

/** Raised when the Host could not be reached at all. */
const NETWORK_MESSAGE = '无法连接宿主服务，源文件暂时不可用';

/** Raised when the Host answered that there is no source file for the book. */
const MISSING_MESSAGE = '这本书没有保留源文件';

/**
 * A source file's metadata, as the Host keeps it next to the book record.
 *
 * @typedef {object} SourceMeta
 * @property {string} fileName - the name the file had when it was imported.
 * @property {string} format - epub, pdf, txt, md or html.
 * @property {string} contentType - the MIME type of the file.
 * @property {number} size - the size in bytes.
 * @property {number} storedAt - when the Host wrote the file down.
 */

/**
 * The query a source file request carries.
 *
 * @param {string} bookId - the book.
 * @param {object} [extra] - extra query parameters.
 * @returns {string} the query string, without the leading question mark.
 */
function sourceQuery(bookId, extra = {}) {
  const id = String(bookId ?? '').trim();
  if (id === '') throw new Error('缺少书籍 id');
  const parts = [`id=${encodeURIComponent(id)}`];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}

/**
 * The file name a download should use.
 *
 * The Host sends the name in `x-reader-file-name`; a name that cannot be
 * decoded is no reason to lose the download, so the book's own name is used
 * instead.
 *
 * @param {Headers} headers - the response headers.
 * @param {string} fallback - the name to fall back to.
 * @returns {string} the file name.
 */
function fileNameFrom(headers, fallback) {
  const raw = headers?.get?.('x-reader-file-name') ?? '';
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The failure of a source request, in the learner's language.
 *
 * @param {Response} response - the Host's answer.
 * @returns {Promise<Error>} the error to throw.
 */
async function failureOf(response) {
  let message = '';
  try {
    const body = await response.json();
    message = typeof body?.error?.message === 'string' ? body.error.message.trim() : '';
  } catch {
    // The Host did not answer with JSON; the status line is all we have.
  }
  if (message !== '') return new Error(message);
  if (response.status === 404) return new Error(MISSING_MESSAGE);
  return new Error(`源文件请求失败（HTTP ${response.status}）`);
}

/**
 * Read the source file of a book.
 *
 * @param {string} bookId - the book.
 * @param {object} [options] - the call options.
 * @param {Function} [options.fetch] - the fetch implementation.
 * @returns {Promise<{ bytes: Uint8Array, fileName: string, contentType: string }>}
 *   the bytes of the file and the name it should be called.
 */
export async function fetchSourceFile(bookId, options = {}) {
  const doFetch = typeof options?.fetch === 'function' ? options.fetch : globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error(NETWORK_MESSAGE);
  let response;
  try {
    response = await doFetch(`${SOURCE_ROUTE}?${sourceQuery(bookId)}`, { method: 'GET' });
  } catch (error) {
    const failure = new Error(NETWORK_MESSAGE);
    failure.cause = error;
    throw failure;
  }
  if (!response.ok) throw await failureOf(response);
  const buffer = await response.arrayBuffer();
  const contentType = response.headers?.get?.('content-type') ?? 'application/octet-stream';
  return {
    bytes: new Uint8Array(buffer),
    fileName: fileNameFrom(response.headers, `${bookId}.bin`),
    contentType,
  };
}

/**
 * Hand the original file to the Host, which writes it next to the shelf.
 *
 * The bytes travel as they are: the request body is the file, and the name,
 * the type and the format travel in the query string.
 *
 * @param {string} bookId - the book the file belongs to.
 * @param {any} file - the browser `File`/`Blob` that was imported.
 * @param {object} [options] - the call options.
 * @param {Function} [options.fetch] - the fetch implementation.
 * @param {string} [options.fileName] - the name to store; the file's own name
 *   by default.
 * @param {string} [options.contentType] - the MIME type to store.
 * @param {string} [options.format] - the format to store (epub, pdf, …).
 * @returns {Promise<SourceMeta|null>} the metadata the Host stored, or null
 *   when the Host has no shelf (the book then simply has no source file).
 */
export async function uploadSourceFile(bookId, file, options = {}) {
  const doFetch = typeof options?.fetch === 'function' ? options.fetch : globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error(NETWORK_MESSAGE);
  if (!file) return null;
  const name = options.fileName ?? (typeof file?.name === 'string' ? file.name : '');
  const contentType = options.contentType ?? (typeof file?.type === 'string' ? file.type : '');
  const format = options.format ?? '';
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    const failure = new Error('无法读取源文件内容');
    failure.cause = error;
    throw failure;
  }
  if (bytes.length === 0) return null;

  let response;
  try {
    response = await doFetch(`${SOURCE_ROUTE}?${sourceQuery(bookId, { name, type: contentType, format })}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    });
  } catch (error) {
    const failure = new Error(NETWORK_MESSAGE);
    failure.cause = error;
    throw failure;
  }
  if (!response.ok) throw await failureOf(response);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // The Host answered with something else; the file may still be stored.
  }
  const result = body?.result;
  if (result === null || typeof result !== 'object') return null;
  return {
    fileName: String(result.fileName ?? name ?? ''),
    format: String(result.format ?? format ?? ''),
    contentType: String(result.contentType ?? contentType ?? ''),
    size: Number(result.size ?? bytes.length),
    storedAt: Number(result.storedAt ?? Date.now()),
  };
}

/**
 * Save the source file of a book to the learner's machine.
 *
 * The bytes are fetched and turned into an object URL, so the browser saves
 * them under the name the file had when it was imported — the `download`
 * attribute of a link wins over the `Content-Disposition` of a response, so
 * the name has to travel with the click.
 *
 * @param {string} bookId - the book.
 * @param {object} [options] - the call options.
 * @param {Function} [options.fetch] - the fetch implementation.
 * @param {Document} [options.document] - the document that holds the link.
 * @returns {Promise<string>} the name the file was saved under.
 */
export async function downloadSourceFile(bookId, options = {}) {
  const source = await fetchSourceFile(bookId, options);
  const doc = options?.document ?? globalThis.document;
  if (!doc || typeof URL?.createObjectURL !== 'function') {
    throw new Error('当前环境不支持下载文件');
  }
  const blob = new Blob([source.bytes], { type: source.contentType });
  const url = URL.createObjectURL(blob);
  try {
    const link = doc.createElement('a');
    link.href = url;
    link.download = source.fileName;
    link.rel = 'noopener';
    link.style.display = 'none';
    doc.body?.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // The browser needs a moment to start the download before the URL dies.
    const timer = setTimeout(() => { URL.revokeObjectURL(url); }, 10000);
    // Node keeps the process alive for a pending timer; the browser does not
    // care, and the tests would otherwise wait for this one.
    if (typeof timer?.unref === 'function') timer.unref();
  }
  return source.fileName;
}

/**
 * A human readable file size.
 *
 * @param {number} size - the size in bytes.
 * @returns {string} the size, e.g. `1.2 MB`.
 */
export function formatBytes(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
