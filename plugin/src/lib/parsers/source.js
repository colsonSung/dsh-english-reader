/**
 * File access helpers.
 *
 * The parsers are handed a browser `File`/`Blob`, but the unit tests run in
 * Node where the platform `File` offers the same surface. Everything therefore
 * goes through capability detection instead of assuming a browser, and text is
 * always decoded from bytes so the legacy-charset fallback can kick in.
 */

/**
 * @param {any} file
 * @returns {string}
 */
export function fileName(file) {
  return typeof file?.name === 'string' ? file.name : '';
}

/**
 * Lower-cased extension without the dot; empty when the name has none.
 * @param {any} file
 * @returns {string}
 */
export function fileExtension(file) {
  const name = fileName(file);
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * File name without its extension — the fallback book title.
 * @param {any} file
 * @returns {string}
 */
export function fileTitle(file) {
  const name = fileName(file);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * @param {any} file
 * @returns {string}
 */
export function fileMimeType(file) {
  return typeof file?.type === 'string' ? file.type.toLowerCase() : '';
}

/**
 * @param {any} file
 * @returns {Promise<Uint8Array>}
 */
export async function readAsBytes(file) {
  if (file instanceof Uint8Array) return file;
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  if (file && typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  throw new Error('无法读取文件内容');
}

/**
 * Decode bytes to text.
 *
 * UTF-8 is the safe default, but Chinese TXT exports are frequently GBK, which
 * decodes to U+FFFD under UTF-8. A legacy-charset retry keeps those books
 * readable instead of silently producing garbage.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeText(bytes) {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    const gbk = new TextDecoder('gbk').decode(bytes);
    if (!gbk.includes('\uFFFD')) return gbk;
  } catch {
    // The runtime has no GBK decoder; the UTF-8 result is the best we have.
  }
  return utf8;
}

/**
 * @param {any} file
 * @returns {Promise<string>}
 */
export async function readAsText(file) {
  return decodeText(await readAsBytes(file));
}
