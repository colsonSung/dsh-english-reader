/**
 * Cover tests.
 *
 * Run: node --test tests/cover.test.mjs
 *
 * The EPUB fixture is built in memory with fflate, so the test exercises the
 * same code path as a real import. jsdom supplies the DOMParser the browser
 * would provide.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { strToU8, zipSync } from 'fflate';
import { crc32, inflateSync } from 'node:zlib';

import { parseEpub } from '../src/lib/parsers/epub.js';
import { coverToDataUrl, generateCover } from '../src/lib/cover.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser;

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head>
<body><h1>Down the Rabbit-Hole</h1>
<p>Alice was beginning to get very tired of sitting by her sister on the bank.</p>
</body></html>`;

const CHAPTER_WITH_IMAGE = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head>
<body><h1>Down the Rabbit-Hole</h1>
<p>Alice was beginning to get very tired of sitting by her sister on the bank.</p>
<img src="images/cover.jpg" alt="cover"/>
</body></html>`;

/** A tiny but valid JPEG header — the bytes only have to survive the zip. */
const COVER_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9,
]);

const COVER_SVG = strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180">'
  + '<rect width="120" height="180" fill="#336699"/></svg>');

/**
 * Build an EPUB in memory.
 *
 * @param {{ coverMode?: 'meta'|'properties'|'image'|'none'|'missing',
 *           coverMediaType?: string, coverHref?: string, coverBytes?: Uint8Array }} [options]
 * @returns {Uint8Array}
 */
function buildEpub(options = {}) {
  const {
    coverMode = 'meta',
    coverMediaType = 'image/jpeg',
    coverHref = 'images/cover.jpg',
    coverBytes = COVER_JPEG,
  } = options;

  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/ch1.xhtml': strToU8(CHAPTER),
  };
  const manifest = ['<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>'];
  const metadata = [];

  if (coverMode === 'meta') {
    metadata.push('<meta name="cover" content="cover-img"/>');
    manifest.push(`<item id="cover-img" href="${coverHref}" media-type="${coverMediaType}"/>`);
    files[`OEBPS/${coverHref}`] = coverBytes;
  } else if (coverMode === 'properties') {
    manifest.push(`<item id="cover-img" href="${coverHref}" media-type="${coverMediaType}" properties="cover-image"/>`);
    files[`OEBPS/${coverHref}`] = coverBytes;
  } else if (coverMode === 'image') {
    files['OEBPS/images/cover.jpg'] = COVER_JPEG;
    files['OEBPS/ch1.xhtml'] = strToU8(CHAPTER_WITH_IMAGE);
  } else if (coverMode === 'missing') {
    // The manifest promises a cover, the archive does not have it.
    metadata.push('<meta name="cover" content="cover-img"/>');
    manifest.push(`<item id="cover-img" href="${coverHref}" media-type="${coverMediaType}"/>`);
  }

  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Alice in Wonderland</dc:title>
<dc:creator>Lewis Carroll</dc:creator>
<dc:language>en</dc:language>
${metadata.join('')}
</metadata>
<manifest>${manifest.join('')}</manifest>
<spine><itemref idref="c1"/></spine>
</package>`);
  return zipSync(files);
}

/**
 * @param {Uint8Array} bytes
 * @returns {File}
 */
function epubFile(bytes) {
  return new File([bytes], 'alice.epub', { type: 'application/epub+zip' });
}

/**
 * Read the chunks of a PNG.
 * @param {Uint8Array} bytes
 * @returns {{ type: string, data: Uint8Array, crcOk: boolean }[]}
 */
function pngChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expected = view.getUint32(offset + 8 + length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
    chunks.push({ type, data, crcOk: crc32(body) === expected });
    offset += 12 + length;
  }
  return chunks;
}

test('the EPUB cover comes from the meta element of the package', async () => {
  const book = await parseEpub(epubFile(buildEpub({ coverMode: 'meta' })));

  assert.equal(book.title, 'Alice in Wonderland');
  assert.equal(book.author, 'Lewis Carroll');
  assert.equal(book.format, 'epub');
  assert.equal(book.chapters.length, 1);
  assert.equal(book.chapters[0].title, 'Down the Rabbit-Hole');

  assert.ok(book.cover, 'the book must have a cover');
  assert.equal(book.cover.mime, 'image/jpeg');
  assert.deepEqual([...book.cover.bytes], [...COVER_JPEG]);
});

test('the media type loses its parameters', async () => {
  const book = await parseEpub(epubFile(buildEpub({
    coverMode: 'meta',
    coverMediaType: 'image/jpeg; charset=binary',
  })));

  assert.equal(book.cover.mime, 'image/jpeg');
});

test('a cover-image property is used when there is no meta element', async () => {
  const book = await parseEpub(epubFile(buildEpub({ coverMode: 'properties' })));

  assert.ok(book.cover);
  assert.equal(book.cover.mime, 'image/jpeg');
  assert.deepEqual([...book.cover.bytes], [...COVER_JPEG]);
});

test('the first image of the reading order is the last resort', async () => {
  const book = await parseEpub(epubFile(buildEpub({ coverMode: 'image' })));

  assert.ok(book.cover);
  assert.equal(book.cover.mime, 'image/jpeg');
  assert.deepEqual([...book.cover.bytes], [...COVER_JPEG]);
});

test('a book without any cover has none', async () => {
  const book = await parseEpub(epubFile(buildEpub({ coverMode: 'none' })));

  assert.equal(book.cover, null);
  assert.equal(book.chapters.length, 1);
});

test('a cover that is not in the archive is no cover', async () => {
  const book = await parseEpub(epubFile(buildEpub({ coverMode: 'missing' })));

  assert.equal(book.cover, null);
});

test('an SVG cover keeps its media type', async () => {
  const book = await parseEpub(epubFile(buildEpub({
    coverMode: 'meta',
    coverMediaType: 'image/svg+xml',
    coverHref: 'images/cover.svg',
    coverBytes: COVER_SVG,
  })));

  assert.ok(book.cover);
  assert.equal(book.cover.mime, 'image/svg+xml');
  assert.deepEqual([...book.cover.bytes], [...COVER_SVG]);
});

test('an SVG cover becomes a data URL without a canvas', async () => {
  const url = await coverToDataUrl({ mime: 'image/svg+xml', bytes: COVER_SVG });

  assert.ok(url, 'an SVG cover must not need a canvas');
  assert.ok(url.startsWith('data:image/svg+xml;base64,'));
  const base64 = url.slice('data:image/svg+xml;base64,'.length);
  assert.ok(Buffer.from(base64, 'base64').toString('utf8').includes('<svg'));
});

test('a cover without an image and a cover without bytes are null', async () => {
  assert.equal(await coverToDataUrl(null), null);
  assert.equal(await coverToDataUrl({ mime: 'image/jpeg', bytes: new Uint8Array(0) }), null);
  assert.equal(await coverToDataUrl({ mime: '', bytes: COVER_JPEG }), null);
});

test('a raster cover does not throw when the host has no canvas', async () => {
  const url = await coverToDataUrl({ mime: 'image/jpeg', bytes: COVER_JPEG });

  // Without a canvas the result is null; with one it is a JPEG data URL.
  assert.ok(url === null || url.startsWith('data:image/jpeg'), `unexpected result: ${url}`);
});

test('the placeholder cover is a valid PNG', async () => {
  const url = await generateCover('Alice in Wonderland', 'Lewis Carroll');

  assert.ok(url.startsWith('data:image/png;base64,'), `unexpected result: ${url}`);
  const bytes = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');

  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const chunks = pngChunks(bytes);
  const types = chunks.map((chunk) => chunk.type);
  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
  for (const chunk of chunks) {
    assert.ok(chunk.crcOk, `the CRC of the ${chunk.type} chunk is wrong`);
  }

  const width = chunks[0].data.readUInt32BE(0);
  const height = chunks[0].data.readUInt32BE(4);
  assert.equal(width, 8);
  assert.equal(height, 12);
  assert.equal(chunks[0].data[8], 8, 'the bit depth must be 8');
  assert.equal(chunks[0].data[9], 2, 'the colour type must be truecolour');

  // The fallback is a single flat colour, so every pixel is the same.
  const raw = inflateSync(Buffer.from(chunks[1].data));
  const stride = 1 + width * 3;
  assert.equal(raw.length, height * stride);
  const first = [raw[1], raw[2], raw[3]];
  for (let y = 0; y < height; y += 1) {
    const start = y * stride;
    assert.equal(raw[start], 0, 'every row must use the "none" filter');
    for (let x = 0; x < width; x += 1) {
      const pixel = start + 1 + x * 3;
      assert.deepEqual([raw[pixel], raw[pixel + 1], raw[pixel + 2]], first);
    }
  }
});

test('the placeholder cover of a book without a title is still an image', async () => {
  const url = await generateCover('', '');

  assert.ok(url.startsWith('data:image/png;base64,'));
  assert.ok(url.length > 100);
});
