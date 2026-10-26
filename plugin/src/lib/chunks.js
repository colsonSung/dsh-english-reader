/**
 * Lazy chunk loading.
 *
 * The browser bundle is loaded by the shell's module loader, which also offers
 * an async `require` for chunks that are fetched on demand. A chunk that never
 * arrives must reject instead of hanging the caller.
 *
 * @param {string} path - chunk path relative to this module, e.g. './client.pdf.js'
 * @param {number} [timeoutMs] - how long to wait before giving up
 * @returns {Promise<any>} the chunk's exports
 */
export async function loadChunk(path, timeoutMs = 20000) {
  // `require` is the shell's module-loader require; esbuild leaves the
  // identifier alone because the bundle is wrapped in the loader factory.
  const loader = typeof require === 'function' ? require : undefined;
  if (loader === undefined || typeof loader.async !== 'function') {
    throw new Error(`chunk loader is unavailable for ${path}`);
  }
  const chunk = await Promise.race([
    loader.async(path),
    new Promise((_resolve, reject) => {
      setTimeout(() => { reject(new Error(`chunk ${path} did not load`)); }, timeoutMs);
    }),
  ]);
  return chunk?.default ?? chunk;
}
