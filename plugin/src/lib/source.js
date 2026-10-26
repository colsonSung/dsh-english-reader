/**
 * Client half of the online book source.
 *
 * The catalogue lives in the Host: it is large and must not be shipped in the
 * bundle. The page asks the Host for a list of hits and for the file of one
 * book; the file comes back as the bytes of an EPUB.
 */

/** The route the Host registers for the English reader. */
export const ROUTE = '/api/english-reader';

/** Raised when the Host could not be reached at all. */
const NETWORK_MESSAGE = '无法连接宿主服务，在线书库暂不可用';

/**
 * Ask the Host for a list of books.
 *
 * @param {object} payload - the search parameters.
 * @param {string} [payload.query] - the search text.
 * @param {number} [payload.limit] - the number of hits.
 * @param {Function} [options.fetch] - the fetch implementation.
 * @returns {Promise<object[]>} the hits.
 */
export async function askSource(payload, options = {}) {
  const doFetch = typeof options?.fetch === 'function' ? options.fetch : globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error(NETWORK_MESSAGE);
  let response;
  try {
    response = await doFetch(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'source', payload: { ...payload, action: 'search' } }),
    });
  } catch (error) {
    const failure = new Error(NETWORK_MESSAGE);
    failure.cause = error;
    throw failure;
  }
  if (response.status === 404 || response.status === 405) {
    throw new Error('宿主尚未加载英语精读插件，请重启应用后重试');
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    const failure = new Error('宿主返回了无法解析的响应');
    failure.cause = error;
    throw failure;
  }
  if (body === null || typeof body !== 'object' || body.ok !== true) {
    const message = typeof body?.error?.message === 'string' ? body.error.message.trim() : '';
    throw new Error(message === '' ? '在线书库请求失败' : message);
  }
  return Array.isArray(body.result) ? body.result : [];
}

/**
 * Download one book from the online source.
 *
 * @param {number} id - the catalogue id.
 * @param {object} [options] - the call options.
 * @param {Function} [options.fetch] - the fetch implementation.
 * @returns {Promise<File>} the book file.
 */
export async function downloadSourceBook(id, options = {}) {
  const doFetch = typeof options?.fetch === 'function' ? options.fetch : globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error(NETWORK_MESSAGE);
  let response;
  try {
    response = await doFetch(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'source', payload: { action: 'download', id } }),
    });
  } catch (error) {
    const failure = new Error(NETWORK_MESSAGE);
    failure.cause = error;
    throw failure;
  }
  if (!response.ok) {
    throw new Error(`下载失败（HTTP ${response.status}）`);
  }
  const buffer = await response.arrayBuffer();
  return new File([buffer], `gutenberg-${id}.epub`, { type: 'application/epub+zip' });
}
