/**
 * DOM helpers shared by the EPUB and HTML parsers.
 *
 * The parsers run in the browser (where `DOMParser` is a global) and in Node
 * tests (where jsdom installs it on `globalThis`). The constructor is resolved
 * lazily on every call so an injected implementation is picked up no matter
 * when it was installed.
 *
 * Namespace handling matters here: OPF/NCX files are XML, where an element is
 * `<dc:title>` with a namespace URI and a local name of `title`, while the
 * same markup parsed as HTML keeps the prefix inside the local name. Lookups
 * therefore match on the local name only and ignore prefixes entirely.
 */

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Elements whose text is never part of the readable body. */
const SKIP_TAGS = new Set([
  'script', 'style', 'nav', 'head', 'noscript', 'template',
  'svg', 'math', 'iframe', 'object', 'embed',
]);

/** Elements that start a new visual block. */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'div', 'dl',
  'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'td', 'th', 'tr', 'ul',
]);

let domParserFactory = null;

/**
 * Override the DOMParser implementation (used by tests and by hosts that
 * sandbox the global). Pass `null` to fall back to `globalThis.DOMParser`.
 * @param {(() => any) | null} factory
 */
export function setDomParserFactory(factory) {
  domParserFactory = typeof factory === 'function' ? factory : null;
}

/**
 * @returns {any} a DOMParser instance
 */
export function getDomParser() {
  const ctor = domParserFactory ?? globalThis.DOMParser;
  if (typeof ctor !== 'function') {
    throw new Error('当前环境不支持 DOM 解析，无法读取该文件');
  }
  return new ctor();
}

/**
 * @param {any} doc
 * @returns {boolean} true when the document only carries a parse error
 */
export function hasParserError(doc) {
  if (!doc || !doc.documentElement) return true;
  const root = doc.documentElement;
  const name = (root.localName || root.nodeName || '').toLowerCase();
  if (name === 'parsererror') return true;
  return Boolean(doc.querySelector?.('parsererror'));
}

/**
 * Parse XML, returning `null` when the markup is not well-formed.
 * @param {string} source
 * @returns {any | null}
 */
export function parseXml(source) {
  const doc = getDomParser().parseFromString(source, 'application/xml');
  return hasParserError(doc) ? null : doc;
}

/**
 * @param {string} source
 * @returns {any}
 */
export function parseHtmlDocument(source) {
  return getDomParser().parseFromString(source, 'text/html');
}

/**
 * Parse an EPUB content document: XHTML first, HTML as the fallback because
 * plenty of published books ship malformed XHTML.
 * @param {string} source
 * @returns {any}
 */
export function parseXhtmlDocument(source) {
  const xhtml = getDomParser().parseFromString(source, 'application/xhtml+xml');
  if (!hasParserError(xhtml)) return xhtml;
  return getDomParser().parseFromString(source, 'text/html');
}

/**
 * @param {any} element
 * @param {string} wanted
 * @returns {boolean}
 */
function matchesLocalName(element, wanted) {
  const local = (element.localName || element.nodeName || '').toLowerCase();
  if (local === wanted) return true;
  const colon = local.indexOf(':');
  return colon > 0 && local.slice(colon + 1) === wanted;
}

/**
 * Collect every descendant element with the given local name.
 * @param {any} root
 * @param {string} localName
 * @returns {any[]}
 */
export function findElements(root, localName) {
  const wanted = String(localName).toLowerCase();
  const out = [];
  if (!root) return out;
  const visit = (node) => {
    const children = node.childNodes;
    if (!children) return;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.nodeType !== ELEMENT_NODE) continue;
      if (matchesLocalName(child, wanted)) out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

/**
 * Read an attribute regardless of whether it is namespaced (`opf:role`) or not.
 * @param {any} element
 * @param {string} name
 * @returns {string | null}
 */
export function getAttr(element, name) {
  if (!element) return null;
  const wanted = name.toLowerCase();
  const direct = element.getAttribute?.(name);
  if (direct != null) return direct;
  const attributes = element.attributes;
  if (!attributes) return null;
  for (let i = 0; i < attributes.length; i += 1) {
    const attribute = attributes[i];
    const attributeName = (attribute.name || '').toLowerCase();
    const localName = (attribute.localName || '').toLowerCase();
    if (attributeName === wanted || localName === wanted) return attribute.value;
    const colon = attributeName.indexOf(':');
    if (colon > 0 && attributeName.slice(colon + 1) === wanted) return attribute.value;
  }
  return null;
}

/**
 * Collapse every whitespace run into a single space.
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function collapseWhitespace(text) {
  return String(text ?? '')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {any} element
 * @returns {boolean}
 */
function isSkipped(element) {
  const tag = (element.localName || element.nodeName || '').toLowerCase();
  return SKIP_TAGS.has(tag);
}

/**
 * @param {any} element
 * @returns {boolean}
 */
function isBlock(element) {
  const tag = (element.localName || element.nodeName || '').toLowerCase();
  return BLOCK_TAGS.has(tag);
}

/**
 * @param {any} element
 * @returns {boolean} true when a descendant is itself a block element
 */
function hasBlockDescendant(element) {
  const children = element.childNodes;
  if (!children) return false;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.nodeType !== ELEMENT_NODE) continue;
    if (isSkipped(child)) continue;
    if (isBlock(child)) return true;
    if (hasBlockDescendant(child)) return true;
  }
  return false;
}

/**
 * Collect the text of a leaf block, turning `<br>` into a space so that words
 * split across a line break do not merge.
 * @param {any} node
 * @returns {string}
 */
function collectText(node) {
  let out = '';
  const children = node.childNodes;
  if (!children) return out;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.nodeType === TEXT_NODE) {
      out += child.nodeValue;
    } else if (child.nodeType === ELEMENT_NODE) {
      if (isSkipped(child)) continue;
      const tag = (child.localName || child.nodeName || '').toLowerCase();
      if (tag === 'br') {
        out += ' ';
        continue;
      }
      out += collectText(child);
    }
  }
  return out;
}

/**
 * Extract the readable paragraphs of a document.
 *
 * Block containers are descended into so that `<div><p>a</p><p>b</p></div>`
 * yields two paragraphs instead of one duplicated blob, while leaf blocks
 * contribute their own text.
 *
 * @param {any} root
 * @param {{ skip?: Set<any> }} [options] - elements to leave out entirely
 * @returns {string[]}
 */
export function extractParagraphs(root, options = {}) {
  const skip = options.skip ?? new Set();
  const paragraphs = [];
  let buffer = '';

  const flush = () => {
    const text = collapseWhitespace(buffer);
    buffer = '';
    if (text) paragraphs.push(text);
  };

  const walk = (node) => {
    const children = node.childNodes;
    if (!children) return;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.nodeType === TEXT_NODE) {
        buffer += child.nodeValue;
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      if (isSkipped(child)) continue;
      const tag = (child.localName || child.nodeName || '').toLowerCase();
      if (skip.has(child)) {
        flush();
        continue;
      }
      if (tag === 'br') {
        buffer += ' ';
        continue;
      }
      if (isBlock(child)) {
        flush();
        if (hasBlockDescendant(child)) {
          walk(child);
        } else {
          buffer += collectText(child);
          flush();
        }
        continue;
      }
      walk(child);
    }
  };

  walk(root);
  flush();
  return paragraphs;
}

/**
 * Headings in document order — the first one is the chapter title of an EPUB
 * content document.
 * @param {any} root
 * @returns {any[]}
 */
export function extractHeadings(root) {
  const out = [];
  const visit = (node) => {
    const children = node.childNodes;
    if (!children) return;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.nodeType !== ELEMENT_NODE) continue;
      if (isSkipped(child)) continue;
      const tag = (child.localName || child.nodeName || '').toLowerCase();
      if (/^h[1-6]$/.test(tag)) out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

/**
 * Resolve a path against a directory, the way an EPUB href points at a file.
 * @param {string} baseDir
 * @param {string} href
 * @returns {string}
 */
export function resolvePath(baseDir, href) {
  const raw = String(href ?? '').split('#')[0].split('?')[0];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A malformed escape is more likely a literal filename than a bug.
  }
  const parts = String(baseDir ?? '').split('/').filter(Boolean);
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/');
}

/**
 * @param {string} path
 * @returns {string} the directory part of a slash separated path
 */
export function dirname(path) {
  const index = String(path ?? '').lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}
