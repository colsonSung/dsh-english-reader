/**
 * Parsing layer tests.
 *
 * Run: node --test tests/parsers.test.mjs
 *
 * jsdom supplies the DOMParser that the browser would provide, so the EPUB and
 * HTML parsers run through exactly the same code path as in production.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { strToU8, zipSync } from 'fflate';

import {
  SUPPORTED_ACCEPT,
  SUPPORTED_EXTENSIONS,
  parseBook,
} from '../src/lib/parsers/index.js';
import { parsePdf } from '../src/lib/parsers/pdf.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const CHAPTER_ONE = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head>
<body><h1>Down the Rabbit-Hole</h1>
<p>Alice was <em>beginning</em> to get very tired of sitting by her sister on the bank.</p>
<p>So she was considering in her own mind.</p></body></html>`;

const CHAPTER_TWO = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Two</title></head>
<body><p>The pool was very deep.</p><p>Or it seemed to be.</p></body></html>`;

const NAV_DOCUMENT = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><ol>
<li><a href="ch1.xhtml">Down the Rabbit-Hole</a></li>
<li><a href="ch2.xhtml">The Pool of Tears</a></li>
</ol></nav></body></html>`;

const NCX_DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head/><docTitle><text>Contents</text></docTitle>
<navMap>
<navPoint id="np1" playOrder="1"><navLabel><text>Down the Rabbit-Hole</text></navLabel><content src="ch1.xhtml"/></navPoint>
<navPoint id="np2" playOrder="2"><navLabel><text>The Pool of Tears</text></navLabel><content src="ch2.xhtml"/></navPoint>
</navMap></ncx>`;

/**
 * Build an EPUB in memory.
 *
 * @param {{ title?: string, author?: string, nav?: boolean, ncx?: boolean, docs?: { file: string, content: string }[] }} [options]
 * @returns {Uint8Array}
 */
function buildEpub(options = {}) {
  const {
    title = 'Alice in Wonderland',
    author = 'Lewis Carroll',
    nav = false,
    ncx = false,
    docs = [
      { file: 'ch1.xhtml', content: CHAPTER_ONE },
      { file: 'ch2.xhtml', content: CHAPTER_TWO },
    ],
  } = options;

  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER_XML),
  };
  const manifest = [];
  const spine = [];
  docs.forEach((doc, index) => {
    files[`OEBPS/${doc.file}`] = strToU8(doc.content);
    manifest.push(`<item id="c${index + 1}" href="${doc.file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${index + 1}"/>`);
  });
  if (nav) {
    files['OEBPS/nav.xhtml'] = strToU8(NAV_DOCUMENT);
    manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  }
  if (ncx) {
    files['OEBPS/toc.ncx'] = strToU8(NCX_DOCUMENT);
    manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  }
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${title}</dc:title>
<dc:creator>${author}</dc:creator>
<dc:language>en</dc:language>
</metadata>
<manifest>${manifest.join('')}</manifest>
<spine>${spine.join('')}</spine>
</package>`);
  return zipSync(files);
}

/**
 * @param {Uint8Array} bytes
 * @param {string} name
 * @returns {File}
 */
function epubFile(bytes, name = 'alice.epub') {
  return new File([bytes], name, { type: 'application/epub+zip' });
}

test('exposes the supported extensions and the accept attribute', () => {
  assert.deepEqual(SUPPORTED_EXTENSIONS, ['epub', 'txt', 'md', 'markdown', 'html', 'htm', 'pdf']);
  assert.equal(SUPPORTED_ACCEPT, '.epub,.txt,.md,.markdown,.html,.htm,.pdf');
});

test('parses an EPUB into metadata, chapters and paragraphs', async () => {
  const book = await parseBook(epubFile(buildEpub({ nav: true })));

  assert.equal(book.title, 'Alice in Wonderland');
  assert.equal(book.author, 'Lewis Carroll');
  assert.equal(book.format, 'epub');
  assert.equal(book.chapters.length, 2);

  // The first heading of the document wins over the table of contents.
  assert.equal(book.chapters[0].title, 'Down the Rabbit-Hole');
  assert.deepEqual(book.chapters[0].paragraphs, [
    'Alice was beginning to get very tired of sitting by her sister on the bank.',
    'So she was considering in her own mind.',
  ]);

  // A document without a heading falls back to the table of contents.
  assert.equal(book.chapters[1].title, 'The Pool of Tears');
  assert.deepEqual(book.chapters[1].paragraphs, [
    'The pool was very deep.',
    'Or it seemed to be.',
  ]);
});

test('falls back to an NCX table of contents', async () => {
  const book = await parseBook(epubFile(buildEpub({ ncx: true })));

  assert.equal(book.chapters.length, 2);
  assert.equal(book.chapters[0].title, 'Down the Rabbit-Hole');
  assert.equal(book.chapters[1].title, 'The Pool of Tears');
});

test('numbers chapters when neither a heading nor a table of contents exists', async () => {
  const book = await parseBook(epubFile(buildEpub({
    docs: [
      {
        file: 'ch1.xhtml',
        content: '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head>'
          + '<body><p>First paragraph.</p></body></html>',
      },
      {
        file: 'ch2.xhtml',
        content: '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head>'
          + '<body><p>The pool was very deep.</p><p>Or it seemed to be.</p></body></html>',
      },
    ],
  })));

  assert.equal(book.chapters.length, 2);
  assert.equal(book.chapters[0].title, '第 1 章');
  assert.equal(book.chapters[1].title, '第 2 章');
  assert.deepEqual(book.chapters[1].paragraphs, ['The pool was very deep.', 'Or it seemed to be.']);
});

test('rejects a file that is not a valid EPUB', async () => {
  await assert.rejects(
    () => parseBook(new File([new Uint8Array([1, 2, 3, 4])], 'broken.epub', { type: 'application/epub+zip' })),
    /EPUB 解析失败/,
  );
});

test('splits a TXT file into paragraphs on blank lines', async () => {
  const file = new File(
    ['First paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.'],
    'notes.txt',
    { type: 'text/plain' },
  );
  const book = await parseBook(file);

  assert.equal(book.format, 'txt');
  assert.equal(book.title, 'notes');
  assert.equal(book.author, '');
  assert.deepEqual(book.chapters[0].paragraphs, [
    'First paragraph.',
    'Second paragraph.',
    'Third paragraph.',
  ]);
});

test('cuts a TXT paragraph that is one huge line into readable pieces', async () => {
  const sentence = 'This sentence is long enough to matter. ';
  const long = sentence.repeat(120).trim();
  const file = new File([long], 'long.txt', { type: 'text/plain' });
  const book = await parseBook(file);

  assert.ok(book.chapters[0].paragraphs.length > 1, 'the long line must be split');
  for (const paragraph of book.chapters[0].paragraphs) {
    assert.ok(paragraph.length <= 2100, `paragraph too long: ${paragraph.length}`);
  }
});

test('removes Markdown markers and splits on blank lines', async () => {
  const markdown = [
    '# The Title',
    '',
    'Some **bold** and *italic* and `code` and ~~struck~~ text with a [link](https://example.com) and an ![image](pic.png).',
    '',
    '- first item',
    '- second item',
    '',
    '> a quoted line',
    '',
    '```js',
    'const answer = 42;',
    '```',
    '',
  ].join('\n');
  const book = await parseBook(new File([markdown], 'book.md', { type: 'text/markdown' }));

  assert.equal(book.format, 'md');
  assert.deepEqual(book.chapters[0].paragraphs, [
    'The Title',
    'Some bold and italic and code and struck text with a link and an image.',
    'first item second item',
    'a quoted line',
    'const answer = 42;',
  ]);
});

test('extracts paragraphs and the title from an HTML file', async () => {
  const html = `<!doctype html><html><head><title>My Book</title><style>p{color:red}</style></head>
<body><script>alert(1)</script><h1>Chapter One</h1><p>First paragraph.</p>
<div><p>Second paragraph.</p><p>Third paragraph.</p></div></body></html>`;
  const book = await parseBook(new File([html], 'book.html', { type: 'text/html' }));

  assert.equal(book.format, 'html');
  assert.equal(book.title, 'My Book');
  assert.deepEqual(book.chapters[0].paragraphs, [
    'Chapter One',
    'First paragraph.',
    'Second paragraph.',
    'Third paragraph.',
  ]);
});

test('rejects an unsupported file format with a Chinese message', async () => {
  await assert.rejects(
    () => parseBook(new File(['x'], 'book.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /不支持的文件格式/);
      return true;
    },
  );
});

test('rejects an empty book instead of returning an empty one', async () => {
  await assert.rejects(
    () => parseBook(new File([''], 'empty.txt', { type: 'text/plain' })),
    /未能从文件中解析出正文内容/,
  );
});

test('reports a Chinese error when the pdf.js chunk cannot be loaded', async () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'scan.pdf', { type: 'application/pdf' });
  await assert.rejects(() => parseBook(file), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /PDF 解析暂不可用/);
    return true;
  });
});

test('extracts one chapter per PDF page', async () => {
  const pageOne = [
    { str: 'The first line of', hasEOL: false, transform: [1, 0, 0, 1, 0, 700] },
    { str: ' the page.', hasEOL: true, transform: [1, 0, 0, 1, 0, 700] },
    { str: '', hasEOL: true, transform: [1, 0, 0, 1, 0, 688] },
    { str: 'Second paragraph.', hasEOL: true, transform: [1, 0, 0, 1, 0, 660] },
  ];
  const pageTwo = [
    { str: 'Line one', hasEOL: true, transform: [1, 0, 0, 1, 0, 700] },
    { str: 'Line two', hasEOL: true, transform: [1, 0, 0, 1, 0, 688] },
    { str: 'Line three', hasEOL: true, transform: [1, 0, 0, 1, 0, 640] },
  ];
  const fakePdfjs = {
    getDocument: (options) => {
      received = options.data;
      return {
        promise: Promise.resolve({
          numPages: 2,
          getMetadata: async () => ({ info: { Title: 'Fake Book', Author: 'Fake Author' } }),
          getPage: async (number) => ({
            getTextContent: async () => ({ items: number === 1 ? pageOne : pageTwo }),
          }),
        }),
      };
    },
  };
  let received = null;

  // A Node `Buffer` is a Uint8Array subclass; pdf.js rejects it, so the parser
  // has to hand over a plain Uint8Array.
  const book = await parsePdf(Buffer.from([1, 2, 3]), { loadChunk: async () => fakePdfjs });

  assert.equal(received.constructor, Uint8Array);
  assert.deepEqual([...received], [1, 2, 3]);

  assert.equal(book.format, 'pdf');
  assert.equal(book.title, 'Fake Book');
  assert.equal(book.author, 'Fake Author');
  assert.equal(book.chapters.length, 2);
  assert.equal(book.chapters[0].title, '第 1 页');
  assert.deepEqual(book.chapters[0].paragraphs, [
    'The first line of the page.',
    'Second paragraph.',
  ]);
  assert.equal(book.chapters[1].title, '第 2 页');
  // The larger vertical distance starts a new paragraph.
  assert.deepEqual(book.chapters[1].paragraphs, ['Line one Line two', 'Line three']);
});
