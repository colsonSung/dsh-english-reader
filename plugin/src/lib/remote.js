/**
 * Client half of the shelf channel.
 *
 * The Host owns the book shelf and writes it to disk; the page only asks for
 * it over the Fetch route `/api/reader`. A Host that has not been
 * restarted yet does not know the `shelf` method and answers
 * `reader/unknown-method`; the client has to read that as "this Host
 * has no shelf" and fall back to the browser's own IndexedDB, so the grey
 * release window (the page is refreshed first, the application restarted
 * later) keeps working.
 *
 * The error codes are the contract between this module and the stores:
 *   - `shelf-unavailable`: the Host has no shelf. The stores use the local
 *     IndexedDB and remember that the Host is gone, so they stop asking.
 *   - `reader/failed`: the Host answered and refused. The message is
 *     the Chinese sentence the learner should read.
 *
 * Nothing here depends on React or on any Host package: this module only
 * speaks HTTP.
 */

/** The route the Host registers for the English reader. */
export const ROUTE = '/api/reader';

/** The error code that says: the Host has no shelf (yet). */
export const SHELF_UNAVAILABLE = 'shelf-unavailable';

/** The error code of a shelf action the Host refused. */
export const SHELF_FAILED = 'reader/failed';

/**
 * The Host codes that mean "this Host does not know the shelf yet".
 *
 * `unknown-method` is what an application that has not been restarted
 * answers; `unknown-action` is what a Host that knows the route but not the
 * action answers. Both mean the same thing for the page.
 *
 * The old `english-reader/…` codes are still recognised: the page is rebuilt
 * long before the application is restarted, and a Host that has not restarted
 * yet still answers with the old ones. Not recognising them would leave the
 * page without a shelf in exactly the window where the fallback matters.
 */
const UNKNOWN_CODES = new Set([
  'reader/unknown-method',
  'reader/unknown-action',
  'english-reader/unknown-method',
  'english-reader/unknown-action',
]);

/** Raised when the Host could not be reached at all. */
const NETWORK_MESSAGE = '无法连接宿主服务，书库暂时不可用';

/** Raised when the Host answered, but has no shelf. */
const UNAVAILABLE_MESSAGE = '宿主书库尚未就绪，请重启应用后重试';

/** Raised when the Host answered, but with a failure. */
const FAILED_MESSAGE = '书库操作失败';

/** Raised when the Host answered with something that is not a JSON body. */
const BAD_RESPONSE_MESSAGE = '宿主返回了无法解析的响应';

/**
 * Build an error with a machine readable code.
 * @param {string} code - the machine readable code.
 * @param {string} message - the Chinese message for the learner.
 * @param {unknown} [cause] - what went wrong underneath.
 * @returns {Error} the error to throw.
 */
function makeError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

/**
 * Ask the Host to run one shelf action.
 *
 * @param {string} action - the action, e.g. `books.list`.
 * @param {object} [payload] - the action payload.
 * @param {object} [options] - the call options.
 * @param {Function} [options.fetch] - the fetch implementation; the page's own
 *   `fetch` by default.
 * @returns {Promise<any>} the result of the action.
 * @throws {Error} with `code === SHELF_UNAVAILABLE` when the Host has no
 *   shelf, with `code === SHELF_FAILED` when the Host refused the action.
 */
export async function callShelf(action, payload = {}, options = {}) {
  const doFetch = typeof options?.fetch === 'function' ? options.fetch : globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw makeError(SHELF_UNAVAILABLE, NETWORK_MESSAGE);
  }

  let response;
  try {
    response = await doFetch(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'shelf', payload: { action, ...(payload ?? {}) } }),
    });
  } catch (error) {
    throw makeError(SHELF_UNAVAILABLE, NETWORK_MESSAGE, error);
  }

  if (response === null || typeof response !== 'object') {
    throw makeError(SHELF_UNAVAILABLE, NETWORK_MESSAGE);
  }

  // A Host that has not loaded the plugin answers 404 through the SPA
  // fallback; a Host that knows the route but not the method answers 400.
  if (response.status === 404 || response.status === 405 || response.status === 400) {
    throw makeError(SHELF_UNAVAILABLE, UNAVAILABLE_MESSAGE);
  }

  let body;
  try {
    body = typeof response.json === 'function' ? await response.json() : null;
  } catch (error) {
    throw makeError(SHELF_FAILED, BAD_RESPONSE_MESSAGE, error);
  }

  if (body === null || typeof body !== 'object' || body.ok !== true) {
    const code = typeof body?.error?.code === 'string' ? body.error.code : '';
    const message = typeof body?.error?.message === 'string' ? body.error.message.trim() : '';
    if (UNKNOWN_CODES.has(code)) {
      throw makeError(SHELF_UNAVAILABLE, UNAVAILABLE_MESSAGE);
    }
    throw makeError(SHELF_FAILED, message === '' ? FAILED_MESSAGE : message);
  }

  return body.result;
}
