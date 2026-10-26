/**
 * Client half of the AI assist channel.
 *
 * The page talks to the Host over the Fetch route `/api/english-reader`; the
 * Host answers with `{ ok, result }` or `{ ok: false, error }`. Every failure
 * that reaches the learner is a Chinese sentence — the page never shows a raw
 * stack or an English transport error.
 *
 * Nothing here depends on React or on any Host package: this module only
 * speaks HTTP.
 */

/** The route the Host registers for the English reader. */
export const ROUTE = '/api/english-reader';

/** Raised when the Host could not be reached at all. */
const NETWORK_MESSAGE = '无法连接宿主服务，AI 功能暂不可用';

/** Raised when the Host answered with something that is not a JSON body. */
const BAD_RESPONSE_MESSAGE = '宿主返回了无法解析的响应';

/** Raised when the Host answered, but with a failure. */
const FAILED_MESSAGE = 'AI 辅助请求失败';

/**
 * Ask the Host for one AI assist result.
 *
 * @param {'word'|'translate'|'breakdown'} method - the method to run.
 * @param {object} payload - the method payload.
 * @param {object} [options] - the call options.
 * @param {Function} [options.fetch] - the fetch implementation; the page's own
 *   `fetch` by default.
 * @returns {Promise<object>} the result, in the shape the contract freezes.
 * @throws {Error} with a Chinese message when the request cannot be served.
 */
export async function askAi(method, payload, options = {}) {
  const doFetch = typeof options?.fetch === 'function' ? options.fetch : globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error(NETWORK_MESSAGE);
  }

  let response;
  try {
    response = await doFetch(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, payload: payload ?? {} }),
    });
  } catch (error) {
    const failure = new Error(NETWORK_MESSAGE);
    failure.cause = error;
    throw failure;
  }

  if (response === null || typeof response !== 'object') {
    throw new Error(BAD_RESPONSE_MESSAGE);
  }

  // The route answers with 200 even for a failed assist, but a Host that has
  // not loaded the plugin yet answers 404 through the SPA fallback.
  if (response.status === 404 || response.status === 405) {
    throw new Error('宿主尚未加载英语精读插件，请重启应用后重试');
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    const failure = new Error(BAD_RESPONSE_MESSAGE);
    failure.cause = error;
    throw failure;
  }

  if (body === null || typeof body !== 'object' || body.ok !== true) {
    const message = typeof body?.error?.message === 'string' ? body.error.message.trim() : '';
    throw new Error(message === '' ? FAILED_MESSAGE : message);
  }

  return body.result;
}
