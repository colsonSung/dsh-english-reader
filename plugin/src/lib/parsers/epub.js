/**
 * EPUB parser.
 *
 * An EPUB is a ZIP container. The reading order and the metadata live in the
 * OPF package document, which is found through `META-INF/container.xml`:
 *
 *   container.xml → rootfile/@full-path → OPF → manifest + spine → content docs
 *
 * Chapter titles come from the first heading of a content document and fall
 * back to the table of contents (EPUB 3 `nav` document or EPUB 2 NCX).
 */

import { strFromU8, unzipSync } from 'fflate';

import {
  collapseWhitespace,
  dirname,
  extractHeadings,
  extractParagraphs,
  findElements,
  getAttr,
  parseHtmlDocument,
  parseXhtmlDocument,
  parseXml,
  resolvePath,
} from './dom.js';
import { fileTitle, readAsBytes } from './source.js';

/**
 * @param {Record<string, Uint8Array>} entries
 * @param {string} path
 * @returns {string | null}
 */
function readEntry(entries, path) {
  const entry = entries[path];
  if (!entry) return null;
  try {
    return strFromU8(entry);
  } catch {
    return null;
  }
}

/**
 * Find the OPF path declared by `META-INF/container.xml`.
 * @param {string | null} containerXml
 * @returns {string}
 */
function resolveOpfPath(containerXml) {
  if (!containerXml) {
    throw new Error('EPUB 解析失败：缺少 META-INF/container.xml');
  }
  const doc = parseXml(containerXml);
  if (doc) {
    for (const rootfile of findElements(doc.documentElement, 'rootfile')) {
      const fullPath = getAttr(rootfile, 'full-path');
      if (fullPath) return resolvePath('', fullPath);
    }
  }
  // A malformed container.xml is common in the wild; the attribute is easy to
  // recover without a well-formed XML tree.
  const match = /full-path\s*=\s*"([^"]+)"/i.exec(containerXml);
  if (match) return resolvePath('', match[1]);
  throw new Error('EPUB 解析失败：container.xml 中没有指向 OPF 的 rootfile');
}

/**
 * Read `dc:title` and `dc:creator` from the package metadata.
 * @param {any} opfDoc
 * @returns {{ title: string, author: string }}
 */
function readMetadata(opfDoc) {
  const metadata = findElements(opfDoc.documentElement, 'metadata')[0] ?? opfDoc.documentElement;
  const titles = findElements(metadata, 'title');
  // The subtitle usually carries an id; the plain title does not.
  const plainTitle = titles.find((element) => !getAttr(element, 'id')) ?? titles[0];
  const creators = findElements(metadata, 'creator');
  const authorElement = creators.find((element) => {
    const role = (getAttr(element, 'role') ?? '').toLowerCase();
    return role === 'aut' || role === 'author';
  }) ?? creators[0];
  return {
    title: collapseWhitespace(plainTitle?.textContent ?? ''),
    author: collapseWhitespace(authorElement?.textContent ?? ''),
  };
}

/**
 * @param {any} opfDoc
 * @returns {{ id: string, href: string, mediaType: string, properties: string[] }[]}
 */
function readManifest(opfDoc) {
  const manifest = findElements(opfDoc.documentElement, 'manifest')[0] ?? opfDoc.documentElement;
  const items = [];
  for (const item of findElements(manifest, 'item')) {
    const href = getAttr(item, 'href');
    if (!href) continue;
    items.push({
      id: getAttr(item, 'id') ?? '',
      href,
      mediaType: (getAttr(item, 'media-type') ?? '').toLowerCase(),
      properties: (getAttr(item, 'properties') ?? '').split(/\s+/).filter(Boolean),
    });
  }
  return items;
}

/** Image media types a browser can render as a thumbnail. */
const IMAGE_MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

/** How many spine documents are inspected for a cover image. */
const COVER_SCAN_LIMIT = 5;

/**
 * The media type without its parameters (`image/jpeg; charset=binary`).
 * @param {string | null | undefined} mediaType
 * @returns {string}
 */
function baseMime(mediaType) {
  return String(mediaType ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * The image media type of a file path, guessed from its extension.
 * @param {string} path
 * @returns {string} '' when the extension is not a known image type
 */
function imageMimeFromPath(path) {
  const name = String(path ?? '').split('#')[0].split('?')[0];
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return IMAGE_MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? '';
}

/**
 * The media type to use for an image: the one the manifest declares, or the
 * one guessed from the file extension.
 * @param {string} path
 * @param {string} mediaType
 * @returns {string} '' when the item is not an image at all
 */
function imageMime(path, mediaType) {
  const declared = baseMime(mediaType);
  if (declared) return declared.startsWith('image/') ? declared : '';
  return imageMimeFromPath(path);
}

/**
 * Read a binary entry out of the unzipped book.
 * @param {Record<string, Uint8Array>} entries
 * @param {string} path
 * @returns {Uint8Array | null}
 */
function readBinaryEntry(entries, path) {
  const entry = entries[path];
  if (!entry || entry.length === 0) return null;
  // Copy the bytes: the unzip buffer is shared and would keep the whole book
  // alive as long as the cover is stored.
  return new Uint8Array(entry);
}

/**
 * The first image of a content document that also exists in the archive.
 * @param {string} text
 * @param {string} docDir
 * @param {Record<string, Uint8Array>} entries
 * @param {{ id: string, href: string, mediaType: string, properties: string[] }[]} manifest
 * @param {string} opfDir
 * @returns {{ mime: string, bytes: Uint8Array } | null}
 */
function findImageInDocument(text, docDir, entries, manifest, opfDir) {
  let doc;
  try {
    doc = parseXhtmlDocument(text);
  } catch {
    return null;
  }
  for (const img of findElements(doc.documentElement, 'img')) {
    const src = getAttr(img, 'src');
    if (!src) continue;
    if (/^(data:|blob:|https?:|\/\/)/i.test(src)) continue;
    const path = resolvePath(docDir, src);
    const item = manifest.find((entry) => resolvePath(opfDir, entry.href) === path);
    const mime = imageMime(path, item ? item.mediaType : '');
    if (!mime) continue;
    const bytes = readBinaryEntry(entries, path);
    if (!bytes) continue;
    return { mime, bytes };
  }
  return null;
}

/**
 * Find the cover image of a book.
 *
 * Three rules, in the order of how explicit they are:
 *   1. `<meta name="cover" content="<manifest id>"/>` — EPUB 2
 *   2. a manifest item with `properties="cover-image"` — EPUB 3
 *   3. the first `<img>` of the reading order that exists in the archive
 *
 * A rule that points at a missing or non-image file falls through to the next
 * one; when no rule applies the book simply has no cover.
 *
 * @param {any} opfDoc
 * @param {{ id: string, href: string, mediaType: string, properties: string[] }[]} manifest
 * @param {{ idref: string, linear: boolean }[]} spine
 * @param {Record<string, Uint8Array>} entries
 * @param {string} opfDir
 * @returns {{ mime: string, bytes: Uint8Array } | null}
 */
function readCover(opfDoc, manifest, spine, entries, opfDir) {
  const byId = new Map(manifest.map((item) => [item.id, item]));

  const meta = findElements(opfDoc.documentElement, 'meta').find((element) => {
    return baseMime(getAttr(element, 'name')) === 'cover';
  });
  const metaId = meta ? (getAttr(meta, 'content') ?? '').trim() : '';
  const candidates = [];
  if (metaId && byId.has(metaId)) candidates.push(byId.get(metaId));
  const coverImage = manifest.find((item) => item.properties.includes('cover-image'));
  if (coverImage) candidates.push(coverImage);

  for (const item of candidates) {
    const path = resolvePath(opfDir, item.href);
    const mime = imageMime(path, item.mediaType);
    if (!mime) continue;
    const bytes = readBinaryEntry(entries, path);
    if (!bytes) continue;
    return { mime, bytes };
  }

  // No declared cover: look at the images of the reading order.
  let scanned = 0;
  for (const ref of spine) {
    if (!ref.linear) continue;
    if (scanned >= COVER_SCAN_LIMIT) break;
    const item = byId.get(ref.idref);
    if (!item) continue;
    const path = resolvePath(opfDir, item.href);
    const text = readEntry(entries, path);
    if (!text) continue;
    scanned += 1;
    const found = findImageInDocument(text, dirname(path), entries, manifest, opfDir);
    if (found) return found;
  }
  return null;
}

/**
 * @param {any} opfDoc
 * @returns {{ idref: string, linear: boolean }[]}
 */
function readSpine(opfDoc) {
  const spine = findElements(opfDoc.documentElement, 'spine')[0] ?? opfDoc.documentElement;
  const refs = [];
  for (const itemref of findElements(spine, 'itemref')) {
    const idref = getAttr(itemref, 'idref');
    if (!idref) continue;
    const linear = (getAttr(itemref, 'linear') ?? 'yes').toLowerCase();
    refs.push({ idref, linear: linear !== 'no' });
  }
  return refs;
}

/**
 * Collect the table of contents of an EPUB 3 `nav` document.
 * @param {any} doc
 * @param {string} baseDir
 * @param {Map<string, string>} map
 */
function collectNavToc(doc, baseDir, map) {
  const navs = findElements(doc.documentElement, 'nav');
  if (!navs.length) return;
  const toc = navs.find((nav) => {
    const type = (getAttr(nav, 'type') ?? '').split(/\s+/);
    return type.includes('toc');
  }) ?? navs[0];
  for (const anchor of findElements(toc, 'a')) {
    const href = getAttr(anchor, 'href');
    if (!href) continue;
    const title = collapseWhitespace(anchor.textContent ?? '');
    if (!title) continue;
    const key = resolvePath(baseDir, href);
    if (!map.has(key)) map.set(key, title);
  }
}

/**
 * Collect the table of contents of an EPUB 2 NCX document.
 * @param {any} doc
 * @param {string} baseDir
 * @param {Map<string, string>} map
 */
function collectNcxToc(doc, baseDir, map) {
  for (const point of findElements(doc.documentElement, 'navpoint')) {
    // The target of a navigation point lives on its `content` element.
    const src = getAttr(findElements(point, 'content')[0], 'src') ?? getAttr(point, 'src');
    if (!src) continue;
    const label = findElements(point, 'navlabel')[0];
    const text = label ? findElements(label, 'text')[0] : null;
    const title = collapseWhitespace(text?.textContent ?? '');
    if (!title) continue;
    const key = resolvePath(baseDir, src);
    if (!map.has(key)) map.set(key, title);
  }
}

/**
 * Build the href → chapter title map from whichever table of contents the
 * book provides.
 * @param {object[]} manifest
 * @param {string} opfDir
 * @param {Record<string, Uint8Array>} entries
 * @returns {Map<string, string>}
 */
function readToc(manifest, opfDir, entries) {
  const map = new Map();
  const navItem = manifest.find((item) => item.properties.includes('nav'));
  if (navItem) {
    const navPath = resolvePath(opfDir, navItem.href);
    const text = readEntry(entries, navPath);
    if (text) collectNavToc(parseXhtmlDocument(text), dirname(navPath), map);
  }
  if (!map.size) {
    const ncxItem = manifest.find((item) => item.mediaType.includes('dtbncx'));
    if (ncxItem) {
      const ncxPath = resolvePath(opfDir, ncxItem.href);
      const text = readEntry(entries, ncxPath);
      if (text) collectNcxToc(parseXml(text) ?? parseHtmlDocument(text), dirname(ncxPath), map);
    }
  }
  return map;
}

/**
 * Parse an EPUB book.
 *
 * The cover is returned as raw bytes together with its media type, so the
 * caller can turn it into a thumbnail; it is `null` when the book has no
 * cover image.
 *
 * @param {any} file
 * @returns {Promise<{ title: string, author: string, format: string, chapters: object[],
 *   cover: { mime: string, bytes: Uint8Array } | null }>}
 */
export async function parseEpub(file) {
  const bytes = await readAsBytes(file);
  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('EPUB 解析失败：文件不是有效的 EPUB（无法解压）');
  }

  const opfPath = resolveOpfPath(readEntry(entries, 'META-INF/container.xml'));
  const opfText = readEntry(entries, opfPath);
  if (!opfText) {
    throw new Error('EPUB 解析失败：找不到 OPF 文件');
  }
  const opfDoc = parseXml(opfText) ?? parseHtmlDocument(opfText);
  const opfDir = dirname(opfPath);

  const { title: metadataTitle, author } = readMetadata(opfDoc);
  const manifest = readManifest(opfDoc);
  const spine = readSpine(opfDoc);
  const manifestById = new Map(manifest.map((item) => [item.id, item]));
  const toc = readToc(manifest, opfDir, entries);

  const chapters = [];
  for (const ref of spine) {
    // Non-linear items are footnotes and similar extras, not reading order.
    if (!ref.linear) continue;
    const item = manifestById.get(ref.idref);
    if (!item) continue;
    const path = resolvePath(opfDir, item.href);
    const text = readEntry(entries, path);
    if (!text) continue;

    const doc = parseXhtmlDocument(text);
    const root = doc.documentElement;
    const heading = extractHeadings(root)[0] ?? null;
    const headingTitle = collapseWhitespace(heading?.textContent ?? '');
    const tocTitle = toc.get(path) ?? '';
    const paragraphs = extractParagraphs(root, { skip: heading ? new Set([heading]) : undefined });

    chapters.push({
      title: headingTitle || tocTitle,
      paragraphs,
      path,
    });
  }

  const kept = chapters.filter((chapter) => chapter.paragraphs.length > 0);
  const numbered = kept.map((chapter, index) => ({
    title: chapter.title || `第 ${index + 1} 章`,
    paragraphs: chapter.paragraphs,
  }));

  return {
    title: metadataTitle || fileTitle(file),
    author,
    format: 'epub',
    chapters: numbered,
    cover: readCover(opfDoc, manifest, spine, entries, opfDir),
  };
}
