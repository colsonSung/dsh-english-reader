/**
 * Covers for the shelf grid.
 *
 * A book cover arrives as raw bytes (see `src/lib/parsers/epub.js`). The grid
 * wants a small image it can put straight into an `<img src>`:
 *
 *   coverToDataUrl()  shrinks a cover into a JPEG data URL
 *   generateCover()   draws a placeholder for a book that has no cover
 *
 * Everything here runs in the browser, so every DOM access is guarded: in a
 * Node test (or in any host without a canvas) the functions return `null` or a
 * solid placeholder instead of throwing.
 */

/** The width a thumbnail is scaled down to when no other width is given. */
const DEFAULT_MAX_WIDTH = 320;

/** The JPEG quality of a generated thumbnail. */
const JPEG_QUALITY = 0.82;

/** The size of a generated placeholder cover (the usual 2:3 book ratio). */
const PLACEHOLDER_WIDTH = 240;
const PLACEHOLDER_HEIGHT = 360;

/**
 * Base64-encode bytes.
 * @param {Uint8Array} bytes
 * @returns {string} '' when the runtime has no base64 encoder
 */
function toBase64(bytes) {
  if (typeof btoa === 'function') {
    let binary = '';
    // Chunked, because `String.fromCharCode(...bytes)` blows the call stack
    // on a cover of a few hundred kilobytes.
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  return '';
}

/**
 * @param {unknown} value
 * @returns {Uint8Array}
 */
function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(0);
}

/**
 * Create a drawing surface, whatever the host offers.
 * @param {number} width
 * @param {number} height
 * @returns {any | null} a canvas, or null when the host has none
 */
function createCanvas(width, height) {
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    if (typeof OffscreenCanvas === 'function') {
      return new OffscreenCanvas(width, height);
    }
  } catch {
    // A sandboxed host may expose `document` but refuse to create elements.
  }
  return null;
}

/**
 * Export a canvas as a data URL.
 * @param {any} canvas
 * @param {string} type
 * @param {number} [quality]
 * @returns {Promise<string | null>}
 */
async function canvasToDataUrl(canvas, type, quality) {
  try {
    if (typeof canvas.toDataURL === 'function') {
      return canvas.toDataURL(type, quality);
    }
    if (typeof canvas.convertToBlob === 'function') {
      const blob = await canvas.convertToBlob({ type, quality });
      return await blobToDataUrl(blob);
    }
  } catch {
    // Tainted canvas (a cover from another origin) — the caller falls back.
  }
  return null;
}

/**
 * @param {any} blob
 * @returns {Promise<string | null>}
 */
async function blobToDataUrl(blob) {
  try {
    if (typeof FileReader === 'function') {
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const base64 = toBase64(bytes);
    return base64 ? `data:${blob.type || 'application/octet-stream'};base64,${base64}` : null;
  } catch {
    return null;
  }
}

/**
 * Decode an image into something that can be drawn.
 * @param {Uint8Array} bytes
 * @param {string} mime
 * @returns {Promise<any | null>} an ImageBitmap, an HTMLImageElement, or null
 */
async function loadImage(bytes, mime) {
  try {
    if (typeof createImageBitmap === 'function' && typeof Blob === 'function') {
      try {
        return await createImageBitmap(new Blob([bytes], { type: mime }));
      } catch {
        // Some browsers refuse SVG or exotic formats here; try the <img> path.
      }
    }
    if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
    if (typeof Blob !== 'function') return null;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('封面解码失败'));
        element.src = url;
      });
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/**
 * Shrink a cover into a small image the shelf can display.
 *
 * Raster covers are scaled down to `maxWidth` (keeping their ratio) and
 * exported as JPEG. SVG covers are passed through unchanged — they are vector
 * images, the browser scales them for free.
 *
 * @param {{ mime: string, bytes: Uint8Array } | null} cover
 * @param {number} [maxWidth]
 * @returns {Promise<string | null>} a data URL, or null when there is no cover
 */
export async function coverToDataUrl(cover, maxWidth = DEFAULT_MAX_WIDTH) {
  try {
    if (!cover) return null;
    const bytes = toBytes(cover.bytes);
    if (!bytes.length) return null;
    const mime = String(cover.mime ?? '').split(';')[0].trim().toLowerCase();
    if (!mime) return null;

    if (mime === 'image/svg+xml') {
      const base64 = toBase64(bytes);
      return base64 ? `data:${mime};base64,${base64}` : null;
    }

    const limit = Number(maxWidth) > 0 ? Number(maxWidth) : DEFAULT_MAX_WIDTH;
    const source = await loadImage(bytes, mime);
    if (!source) return null;
    const sourceWidth = source.width || source.naturalWidth || 0;
    const sourceHeight = source.height || source.naturalHeight || 0;
    if (!sourceWidth || !sourceHeight) return null;

    const scale = sourceWidth > limit ? limit / sourceWidth : 1;
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = createCanvas(width, height);
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, width, height);
    if (typeof source.close === 'function') source.close();
    return await canvasToDataUrl(canvas, 'image/jpeg', JPEG_QUALITY);
  } catch {
    return null;
  }
}

/**
 * A stable number in [0, 360) for a string.
 * @param {string} text
 * @returns {number}
 */
function hashHue(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(i)) % 360;
  }
  return Math.abs(hash) % 360;
}

/**
 * @param {number} hue
 * @param {number} saturation
 * @param {number} lightness
 * @returns {[number, number, number]} the RGB components
 */
function hslToRgb(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (hue % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (sector < 1) [r, g, b] = [chroma, second, 0];
  else if (sector < 2) [r, g, b] = [second, chroma, 0];
  else if (sector < 3) [r, g, b] = [0, chroma, second];
  else if (sector < 4) [r, g, b] = [0, second, chroma];
  else if (sector < 5) [r, g, b] = [second, 0, chroma];
  else [r, g, b] = [chroma, 0, second];
  const offset = lightness - chroma / 2;
  return [
    Math.round((r + offset) * 255),
    Math.round((g + offset) * 255),
    Math.round((b + offset) * 255),
  ];
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {Uint8Array}
 */
function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** The CRC-32 table of the PNG specification. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * @param {number} value
 * @returns {Uint8Array} the value as four big-endian bytes
 */
function uint32BE(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0);
  return bytes;
}

/**
 * Wrap data in a zlib stream of uncompressed (stored) blocks.
 *
 * A stored block is valid deflate, which keeps this encoder small enough to
 * ship without a compression library — the only thing the fallback needs is a
 * solid colour.
 *
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function zlibStore(data) {
  let out = new Uint8Array([0x78, 0x01]);
  const append = (chunk) => { out = concatBytes(out, chunk); };
  const max = 0xffff;
  let offset = 0;
  if (data.length === 0) {
    append(new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]));
  }
  while (offset < data.length) {
    const size = Math.min(max, data.length - offset);
    const final = offset + size >= data.length ? 1 : 0;
    const inverse = (~size) & 0xffff;
    const header = new Uint8Array(5);
    header[0] = final;
    header[1] = size & 0xff;
    header[2] = (size >>> 8) & 0xff;
    header[3] = inverse & 0xff;
    header[4] = (inverse >>> 8) & 0xff;
    append(header);
    append(data.subarray(offset, offset + size));
    offset += size;
  }
  append(uint32BE(adler32(data)));
  return out;
}

/**
 * @param {string} type
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function pngChunk(type, data) {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) typeBytes[i] = type.charCodeAt(i);
  const body = concatBytes(typeBytes, data);
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(body, 4);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(body));
  return out;
}

/**
 * A solid colour PNG, used when the host has no canvas.
 *
 * The image is tiny (8×12 pixels) because a flat colour survives any scaling
 * without artefacts — the shelf stretches it to the size of the tile.
 *
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number]} rgb
 * @returns {Uint8Array}
 */
function encodeSolidPng(width, height, rgb) {
  const stride = 1 + width * 3;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const start = y * stride;
    raw[start] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const pixel = start + 1 + x * 3;
      raw[pixel] = rgb[0];
      raw[pixel + 1] = rgb[1];
      raw[pixel + 2] = rgb[2];
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  return concatBytes(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    concatBytes(
      pngChunk('IHDR', header),
      concatBytes(pngChunk('IDAT', zlibStore(raw)), pngChunk('IEND', new Uint8Array(0))),
    ),
  );
}

/**
 * The first letter of a title, or `?` when the title has none.
 * @param {string} title
 * @returns {string}
 */
function coverInitial(title) {
  const match = /[A-Za-z0-9À-ɏ一-鿿]/.exec(String(title ?? ''));
  return match ? match[0].toUpperCase() : '?';
}

/**
 * Draw a placeholder cover for a book that has none.
 *
 * The background is a gradient picked from a hash of the title, so the same
 * book always gets the same colour, and the initial of the title sits in the
 * middle.
 *
 * @param {string} title
 * @param {string} [author]
 * @returns {Promise<string>} a PNG data URL
 */
export async function generateCover(title, author = '') {
  const name = String(title ?? '').trim();
  const hue = hashHue(name);
  const rgb = hslToRgb(hue, 0.55, 0.38);
  try {
    const canvas = createCanvas(PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT);
    if (!canvas) {
      return pngDataUrl(encodeSolidPng(8, 12, rgb));
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return pngDataUrl(encodeSolidPng(8, 12, rgb));
    }

    const gradient = context.createLinearGradient(0, 0, PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT);
    gradient.addColorStop(0, `hsl(${hue}, 58%, 46%)`);
    gradient.addColorStop(1, `hsl(${(hue + 42) % 360}, 52%, 28%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT);

    context.fillStyle = 'rgba(255, 255, 255, 0.94)';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `600 ${Math.round(PLACEHOLDER_WIDTH * 0.42)}px Georgia, "Songti SC", serif`;
    context.fillText(coverInitial(name), PLACEHOLDER_WIDTH / 2, PLACEHOLDER_HEIGHT * 0.44);

    const byline = String(author ?? '').trim();
    if (byline) {
      context.fillStyle = 'rgba(255, 255, 255, 0.72)';
      context.font = `400 ${Math.round(PLACEHOLDER_WIDTH * 0.075)}px -apple-system, "PingFang SC", sans-serif`;
      context.fillText(truncate(byline, 28), PLACEHOLDER_WIDTH / 2, PLACEHOLDER_HEIGHT * 0.86);
    }

    const url = await canvasToDataUrl(canvas, 'image/png');
    return url ?? pngDataUrl(encodeSolidPng(8, 12, rgb));
  } catch {
    return pngDataUrl(encodeSolidPng(8, 12, rgb));
  }
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function pngDataUrl(bytes) {
  const base64 = toBase64(bytes);
  return base64 ? `data:image/png;base64,${base64}` : '';
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
